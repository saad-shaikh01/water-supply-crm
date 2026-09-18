import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { LedgerEntryStatus, StaffLedgerCategory, StandaloneCrewCashStatus } from '@prisma/client';
import type { AuthUser } from '@water-supply-crm/types';
import { paginate } from '../../common/helpers/paginate';
import { isFutureVendorDate, vendorDateString } from '../../common/helpers/date.util';
import { AuditService } from '../audit/audit.service';
import { CashLedgerPeriodGuard } from '../van-cash-ledger/cash-ledger-period.guard';
import { StaffLedgerService } from './staff-ledger.service';
import { isStandaloneCrewCashTwinLocked, STANDALONE_CREW_CASH_LOCKED_REASON } from './standalone-crew-cash-lock.util';
import { CreateStandaloneCrewCashDto } from './dto/create-standalone-crew-cash.dto';
import { UpdateStandaloneCrewCashDto } from './dto/update-standalone-crew-cash.dto';
import { VoidStandaloneCrewCashDto } from './dto/void-standalone-crew-cash.dto';
import { StandaloneCrewCashQueryDto } from './dto/standalone-crew-cash-query.dto';

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Calendar day (YYYY-MM-DD, Asia/Karachi) a date input refers to — a bare date is taken literally. */
function vendorDay(input: string | Date): string {
  if (typeof input === 'string' && DATE_ONLY_RE.test(input)) return input;
  return vendorDateString(typeof input === 'string' ? new Date(input) : input);
}

function twinDescription(category: string, notes: string | null | undefined): string {
  return `Crew Cash (no sheet) — ${category}${notes ? `: ${notes}` : ''}`;
}

const rowInclude = {
  employee: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  voidedBy: { select: { id: true, name: true } },
};

/**
 * Crew Cash recorded WITHOUT a Daily Sheet (owner-requested 2026-09-18) —
 * see the model doc comment on `StandaloneCrewCashExpense` in schema.prisma
 * for the full problem/solution writeup. Same "vendor-wide cash tier,
 * single-step, audit-logged" shape `FuelCardService` already established for
 * Fuel Card top-ups: draws down the Office Cash Ledger's available balance
 * the instant it's recorded (see VanCashLedgerService's
 * computeAvailableBalance/getStats/getTimeline), never an Expense, never a
 * CrewCashDistribution row (those stay strictly Daily-Sheet-scoped).
 *
 * Unlike CrewCashDistribution, there is no "sheet close" boundary to sync
 * at, so the StaffLedgerEntry (category CREW_CASH, a debit against the
 * employee) is created in the SAME transaction as this row, via
 * `StaffLedgerService.createTx` — it still passes through the ledger's own
 * approval-threshold gate like any other manually-typed entry (this entity
 * has no approval gate of its own).
 */
@Injectable()
export class StandaloneCrewCashService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly staffLedger: StaffLedgerService,
    private readonly audit: AuditService,
    private readonly periodGuard: CashLedgerPeriodGuard,
  ) {}

  async create(user: AuthUser, dto: CreateStandaloneCrewCashDto) {
    const employee = await this.prisma.user.findFirst({
      where: { id: dto.employeeId, vendorId: user.vendorId },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException('Employee not found.');

    if (dto.date && isFutureVendorDate(dto.date)) {
      throw new BadRequestException('Crew cash cannot be dated in the future.');
    }
    const date = dto.date ? new Date(dto.date) : new Date();

    await this.periodGuard.assertWritable(user.vendorId, [date], { userId: user.userId });

    const created = await this.prisma.$transaction(async (tx) => {
      const ledgerEntry = await this.staffLedger.createTx(tx, user, {
        userId: dto.employeeId,
        category: StaffLedgerCategory.CREW_CASH,
        amount: -dto.amount,
        effectiveDate: date.toISOString(),
        description: twinDescription(dto.category, dto.notes),
      });

      return tx.standaloneCrewCashExpense.create({
        data: {
          vendorId: user.vendorId,
          employeeId: dto.employeeId,
          category: dto.category,
          amount: dto.amount,
          notes: dto.notes ?? null,
          date,
          staffLedgerEntryId: ledgerEntry.id,
          createdById: user.userId,
        },
        include: rowInclude,
      });
    });

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'CREATED',
      entity: 'StandaloneCrewCashExpense',
      entityId: created.id,
      changes: {
        after: { employeeId: created.employeeId, category: created.category, amount: created.amount, date: created.date },
      },
    });

    return created;
  }

  async list(user: AuthUser, query: StandaloneCrewCashQueryDto) {
    const { page = 1, limit = 20, employeeId, dateFrom, dateTo } = query;
    const where: Record<string, unknown> = { vendorId: user.vendorId };
    if (employeeId) where.employeeId = employeeId;
    if (dateFrom || dateTo) {
      const date: { gte?: Date; lte?: Date } = {};
      if (dateFrom) date.gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        date.lte = end;
      }
      where.date = date;
    }

    const [data, total] = await Promise.all([
      this.prisma.standaloneCrewCashExpense.findMany({
        where,
        include: rowInclude,
        orderBy: { date: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.standaloneCrewCashExpense.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  /**
   * Edits an entry in place (Cash Ledger P2). The row is rewritten and its
   * StaffLedgerEntry "payroll twin" is voided + re-created in the SAME
   * transaction, so the employee's payroll ledger always mirrors the row.
   *
   * Twin rules: while the twin has not rolled into a locked payroll period
   * (`payrollEntryId === null`) the edit is allowed; once it has, payroll
   * figures are frozen history and the edit is BLOCKED — the user is told to
   * void (which reverses in the current payroll period) and re-record. A
   * VOIDED twin on an ACTIVE row is an inconsistency and is rejected.
   *
   * Ordering inside the tx: optimistic CAS on the row's `version` FIRST (a
   * stale request fails before any twin is touched), then void the old twin,
   * then create the fresh twin (which re-runs the payroll approval gate — it
   * may legitimately land PENDING, exactly like create), then rewrite the row.
   */
  async update(user: AuthUser, id: string, dto: UpdateStandaloneCrewCashDto) {
    const row = await this.prisma.standaloneCrewCashExpense.findFirst({ where: { id, vendorId: user.vendorId } });
    if (!row) throw new NotFoundException('Standalone crew cash entry not found.');
    if (row.status === StandaloneCrewCashStatus.VOIDED) {
      throw new BadRequestException('A voided entry cannot be edited.');
    }

    if (dto.date && isFutureVendorDate(dto.date)) {
      throw new BadRequestException('Crew cash cannot be dated in the future.');
    }

    // What actually changed vs the stored row. A date only counts as changed when the vendor
    // calendar day differs — re-sending the same day must not clobber the stored time-of-day.
    const requestedNotes = dto.notes === undefined ? undefined : dto.notes.trim() === '' ? null : dto.notes;
    const employeeChanged = dto.employeeId !== undefined && dto.employeeId !== row.employeeId;
    const categoryChanged = dto.category !== undefined && dto.category !== row.category;
    const amountChanged = dto.amount !== undefined && dto.amount !== row.amount;
    const dateChanged = dto.date !== undefined && vendorDay(dto.date) !== vendorDay(row.date);
    const notesChanged = requestedNotes !== undefined && requestedNotes !== row.notes;
    if (!employeeChanged && !categoryChanged && !amountChanged && !dateChanged && !notesChanged) {
      throw new BadRequestException('Nothing to update — change at least one field.');
    }

    const newEmployeeId = dto.employeeId ?? row.employeeId;
    const newCategory = dto.category ?? row.category;
    const newAmount = dto.amount ?? row.amount;
    const newDate = dateChanged ? new Date(dto.date as string) : row.date;
    const newNotes = notesChanged ? (requestedNotes as string | null) : row.notes;

    if (employeeChanged) {
      const employee = await this.prisma.user.findFirst({
        where: { id: newEmployeeId, vendorId: user.vendorId },
        select: { id: true },
      });
      if (!employee) throw new NotFoundException('Employee not found.');
    }

    // Cash-ledger period guard — an edit writes into BOTH the old and the new date's period.
    await this.periodGuard.assertWritable(user.vendorId, [row.date, newDate], { userId: user.userId });

    // Fail fast (nothing mutated) when the twin is already locked / inconsistent. Re-checked
    // inside the tx against the live row so a concurrent payroll lock can't slip through.
    const preTwin = await this.prisma.staffLedgerEntry.findFirst({
      where: { id: row.staffLedgerEntryId, vendorId: user.vendorId },
    });
    this.assertTwinEditable(preTwin);

    const updated = await this.prisma.$transaction(async (tx) => {
      // 1. CAS on the row FIRST — a stale version aborts before any twin is touched.
      const claim = await tx.standaloneCrewCashExpense.updateMany({
        where: { id, vendorId: user.vendorId, status: StandaloneCrewCashStatus.ACTIVE, version: dto.version },
        data: { version: { increment: 1 } },
      });
      if (claim.count === 0) {
        throw new ConflictException(
          `Version mismatch: expected ${row.version}, received ${dto.version}. Reload and retry.`,
        );
      }

      // 2. Live twin read (its own version is the CAS token for the void).
      const twin = this.assertTwinEditable(
        await tx.staffLedgerEntry.findFirst({ where: { id: row.staffLedgerEntryId, vendorId: user.vendorId } }),
      );

      // 3. Void the old twin (creator gate skipped — `crew_cash:edit` already authorized the caller).
      await this.staffLedger.voidEntryTx(
        tx,
        user,
        twin.id,
        { version: twin.version, reason: dto.reason },
        { skipCreatorCheck: true },
      );

      // 4. Fresh twin for the corrected employee/amount/date (re-runs the approval gate — may be PENDING).
      const freshTwin = await this.staffLedger.createTx(tx, user, {
        userId: newEmployeeId,
        category: StaffLedgerCategory.CREW_CASH,
        amount: -newAmount,
        effectiveDate: newDate.toISOString(),
        description: twinDescription(newCategory, newNotes),
      });

      // 5. Rewrite the row and repoint it at the fresh twin (`version` was already bumped by the CAS).
      await tx.standaloneCrewCashExpense.update({
        where: { id },
        data: {
          employeeId: newEmployeeId,
          category: newCategory,
          amount: newAmount,
          date: newDate,
          notes: newNotes,
          staffLedgerEntryId: freshTwin.id,
          editCount: { increment: 1 },
          lastEditedAt: new Date(),
          updatedById: user.userId,
        },
      });

      return tx.standaloneCrewCashExpense.findUniqueOrThrow({ where: { id }, include: rowInclude });
    });

    // Audit: only the fields that actually changed (+ the twin pointer), amounts as numbers, dates ISO.
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    if (employeeChanged) {
      before.employeeId = row.employeeId;
      after.employeeId = updated.employeeId;
    }
    if (categoryChanged) {
      before.category = row.category;
      after.category = updated.category;
    }
    if (amountChanged) {
      before.amount = Number(row.amount);
      after.amount = Number(updated.amount);
    }
    if (dateChanged) {
      before.date = row.date.toISOString();
      after.date = updated.date.toISOString();
    }
    if (notesChanged) {
      before.notes = row.notes;
      after.notes = updated.notes;
    }
    before.ledgerTwinId = row.staffLedgerEntryId;
    after.ledgerTwinId = updated.staffLedgerEntryId;

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'UPDATED',
      entity: 'StandaloneCrewCashExpense',
      entityId: updated.id,
      changes: { before, after, reason: dto.reason },
    });

    return updated;
  }

  /**
   * The twin must exist, not be VOIDED (inconsistent for an ACTIVE row) and not
   * be rolled into a locked payroll period. Returns the narrowed twin.
   */
  private assertTwinEditable<T extends { status: LedgerEntryStatus; payrollEntryId: string | null }>(
    twin: T | null,
  ): T {
    if (!twin) {
      throw new BadRequestException('The linked payroll ledger entry for this crew cash could not be found.');
    }
    if (twin.status === LedgerEntryStatus.VOIDED) {
      throw new BadRequestException(
        'The linked payroll ledger entry for this crew cash is already voided, so it cannot be edited. Void this entry and record a new one.',
      );
    }
    if (isStandaloneCrewCashTwinLocked(twin)) {
      throw new BadRequestException(STANDALONE_CREW_CASH_LOCKED_REASON);
    }
    return twin;
  }

  /**
   * Voids the row and its linked `StaffLedgerEntry` together. If the ledger
   * entry hasn't yet rolled into a locked payroll period, it's voided
   * directly (`voidEntryTx`); otherwise it's reversed (`reverseTx`) — the
   * same not-locked-vs-locked branching `CrewCashDistributionService.
   * correctSyncedEntry` uses. The ledger entry's own `version` is read live
   * inside this transaction rather than trusted from the client, since the
   * caller only ever supplies a reason here, not a ledger version token.
   */
  async void(user: AuthUser, id: string, dto: VoidStandaloneCrewCashDto) {
    const row = await this.prisma.standaloneCrewCashExpense.findFirst({ where: { id, vendorId: user.vendorId } });
    if (!row) throw new NotFoundException('Standalone crew cash entry not found.');
    if (row.status === StandaloneCrewCashStatus.VOIDED) {
      throw new BadRequestException('This entry is already voided.');
    }

    await this.periodGuard.assertWritable(user.vendorId, [row.date], { userId: user.userId });

    const updated = await this.prisma.$transaction(async (tx) => {
      const ledgerEntry = await tx.staffLedgerEntry.findUniqueOrThrow({ where: { id: row.staffLedgerEntryId } });

      if (ledgerEntry.status === LedgerEntryStatus.POSTED && ledgerEntry.payrollEntryId !== null) {
        await this.staffLedger.reverseTx(tx, user, ledgerEntry.id, { version: ledgerEntry.version, reason: dto.reason });
      } else {
        // The twin is system-created; `crew_cash:delete` at the controller already authorized the
        // caller, so skip the ledger's own "creator OR payroll:ledger_void" gate (status/lock/CAS
        // rules still apply).
        await this.staffLedger.voidEntryTx(
          tx,
          user,
          ledgerEntry.id,
          { version: ledgerEntry.version, reason: dto.reason },
          { skipCreatorCheck: true },
        );
      }

      const claim = await tx.standaloneCrewCashExpense.updateMany({
        where: { id, vendorId: user.vendorId, status: StandaloneCrewCashStatus.ACTIVE },
        data: {
          status: StandaloneCrewCashStatus.VOIDED,
          voidedById: user.userId,
          voidedAt: new Date(),
          voidReason: dto.reason,
        },
      });
      if (claim.count === 0) {
        throw new BadRequestException('This entry was already voided by someone else. Reload and retry.');
      }

      return tx.standaloneCrewCashExpense.findUniqueOrThrow({ where: { id }, include: rowInclude });
    });

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'VOIDED',
      entity: 'StandaloneCrewCashExpense',
      entityId: updated.id,
      // `after.voidReason` kept for legacy history reads; `changes.reason` is the canonical location.
      changes: {
        before: { status: row.status },
        after: { status: updated.status, voidReason: dto.reason },
        reason: dto.reason,
      },
    });

    return updated;
  }
}
