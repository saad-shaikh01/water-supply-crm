import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { LedgerEntryStatus, Prisma, SheetAdvanceStatus, StaffLedgerCategory } from '@prisma/client';
import type { AuthUser } from '@water-supply-crm/types';
import { vendorDateString } from '../../common/helpers/date.util';
import { AuditService } from '../audit/audit.service';
import { PermissionService } from '../authz/permission.service';
import { resolveSheetCash, SHEET_CASH_RELOAD_INCLUDE } from '../daily-sheet/sheet-cash.util';
import { VanCashLedgerService } from '../van-cash-ledger/van-cash-ledger.service';
import { StaffLedgerService } from './staff-ledger.service';
import { resolveSheetLedgerDate } from './sheet-ledger-date.util';
import { CreateSheetAdvanceDto } from './dto/create-sheet-advance.dto';
import { UpdateSheetAdvanceDto } from './dto/update-sheet-advance.dto';
import { RemoveSheetAdvanceDto } from './dto/remove-sheet-advance.dto';

const LOCKED_TWIN_MESSAGE =
  "This advance has already been rolled into a locked payroll period, so it can no longer be edited. " +
  'Delete it and record a new one instead — the delete reverses it in the current payroll period.';

/** Same include every response uses — the twin's status/lock state drives the UI's "Pending approval" badge. */
export const SHEET_ADVANCE_INCLUDE = {
  employee: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  staffLedgerEntry: { select: { id: true, status: true, payrollEntryId: true } },
} satisfies Prisma.SheetAdvanceInclude;

function twinDescription(sheetDate: Date, notes: string | null | undefined): string {
  return `Advance from daily sheet ${vendorDateString(sheetDate)}${notes ? `: ${notes}` : ''}`;
}

/**
 * Salary advance handed out of the van's cash during a Daily Sheet (owner-requested
 * 2026-10-01) — see the `SheetAdvance` model comment in schema.prisma for the full
 * problem/solution writeup.
 *
 * Money rules (the reason this is its own entity rather than a plain ADVANCE entry):
 *   - The cash left the DRIVER's pocket, so the amount reduces the sheet's
 *     cash-to-hand-in (`buildReconciliation`'s `advances.total`) exactly like an
 *     Expense / Crew Cash row. That holds from the moment it is recorded,
 *     regardless of the payroll approval gate (the cash is already gone).
 *   - It is NOT office cash, so the Cash Ledger's PAYROLL_CASH source skips every
 *     twin with a `sheetAdvanceSource` — otherwise the same rupees would leave twice.
 *   - It still lands in the employee's payroll "advances" bucket: each row owns one
 *     `StaffLedgerEntry` (category ADVANCE, a debit) created in the SAME transaction
 *     via `StaffLedgerService.createTx`, so it passes the ledger's own approval gate
 *     (it may legitimately be PENDING) and is approved from the Payroll page.
 *
 * Closed sheets: add / edit / delete are all allowed with a mandatory reason and
 * `daily_sheets:edit_closed_expense`. Each bumps the shared
 * `postCloseCrewCashCorrectionCount` marker (the sheet then recomputes its cash live)
 * and corrects the Cash Ledger handover chain in the same transaction — the frozen
 * close-time `cashExpected` is never rewritten.
 */
@Injectable()
export class SheetAdvanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly staffLedger: StaffLedgerService,
    private readonly audit: AuditService,
    private readonly permissions: PermissionService,
    private readonly vanCashLedger: VanCashLedgerService,
  ) {}

  /**
   * The sheet is already closed → the caller needs the closed-sheet permission and a
   * written reason. Returns the trimmed reason ('' for an open sheet).
   */
  private async assertClosedSheetAccess(user: AuthUser, isClosed: boolean, reason: string | undefined): Promise<string> {
    const trimmed = reason?.trim() ?? '';
    if (!isClosed) return trimmed;
    if (trimmed.length < 3) {
      throw new BadRequestException('A reason is required to change advances on a closed daily sheet.');
    }
    const allowed = await this.permissions.can(user.userId, 'daily_sheets:edit_closed_expense');
    if (!allowed) {
      throw new ForbiddenException('You do not have permission to change advances on a closed daily sheet.');
    }
    return trimmed;
  }

  /**
   * Edit/void authorization — "creator OR payroll:ledger_void", the same precedent as
   * `StaffLedgerService.voidEntry` (editing here IS a void + re-post of the payroll twin).
   */
  private async assertCanManage(user: AuthUser, row: { createdById: string }) {
    if (row.createdById === user.userId) return;
    if (await this.permissions.can(user.userId, 'payroll:ledger_void')) return;
    throw new ForbiddenException('You may only change a Daily Sheet advance you recorded yourself.');
  }

  /**
   * A closed sheet's cash-out rows changed: bump the shared marker so the sheet
   * switches to a live cash recompute, and hand the fresh figure to the Cash Ledger
   * handover chain (a no-op on a zero delta). Reloads INSIDE the caller's transaction so
   * it sees the just-applied row change. No-op on an open sheet.
   */
  private async syncClosedSheet(tx: Prisma.TransactionClient, vendorId: string, dailySheetId: string) {
    const sheet = await tx.dailySheet.findUnique({ where: { id: dailySheetId }, select: { isClosed: true } });
    if (!sheet?.isClosed) return;

    await tx.dailySheet.update({
      where: { id: dailySheetId },
      data: { postCloseCrewCashCorrectionCount: { increment: 1 } },
    });

    const reloaded = await tx.dailySheet.findUnique({
      where: { id: dailySheetId },
      include: SHEET_CASH_RELOAD_INCLUDE,
    });
    if (!reloaded) return;
    const resolved = resolveSheetCash(reloaded as unknown as Record<string, unknown>);
    await this.vanCashLedger.handlePostCloseCorrection(tx, vendorId, dailySheetId, resolved.cashExpected);
  }

  async create(user: AuthUser, dailySheetId: string, dto: CreateSheetAdvanceDto) {
    const sheet = await this.prisma.dailySheet.findFirst({
      where: { id: dailySheetId, vendorId: user.vendorId },
      select: { id: true, date: true, isClosed: true },
    });
    if (!sheet) throw new NotFoundException('Daily sheet not found.');

    const reason = await this.assertClosedSheetAccess(user, sheet.isClosed, dto.reason);

    const employee = await this.prisma.user.findFirst({
      where: { id: dto.employeeId, vendorId: user.vendorId, isActive: true },
      select: { id: true },
    });
    if (!employee) throw new BadRequestException('The selected employee was not found or is inactive.');

    // Trip attribution — inferred server-side, same as Expense / Crew Cash: the
    // active trip on an open sheet, the last-ended trip on a closed one.
    const tripLoad = sheet.isClosed
      ? await this.prisma.dailySheetLoad.findFirst({
          where: { dailySheetId, endedAt: { not: null } },
          orderBy: { endedAt: 'desc' },
          select: { id: true },
        })
      : await this.prisma.dailySheetLoad.findFirst({ where: { dailySheetId, endedAt: null }, select: { id: true } });

    const notes = dto.notes?.trim() || null;

    const created = await this.prisma.$transaction(async (tx) => {
      const effectiveDate = await resolveSheetLedgerDate(tx, user.vendorId, sheet.date);

      // Payroll twin first (a debit — negative). It runs the ledger's own approval gate, so it
      // may come back PENDING; the cash is out of the van either way.
      const twin = await this.staffLedger.createTx(
        tx,
        user,
        {
          userId: dto.employeeId,
          category: StaffLedgerCategory.ADVANCE,
          amount: -dto.amount,
          effectiveDate: effectiveDate.toISOString(),
          description: twinDescription(sheet.date, notes),
        },
        { skipPeriodGuard: true },
      );

      const row = await tx.sheetAdvance.create({
        data: {
          vendorId: user.vendorId,
          dailySheetId,
          employeeId: dto.employeeId,
          amount: dto.amount,
          notes,
          date: sheet.date,
          staffLedgerEntryId: twin.id,
          dailySheetLoadId: tripLoad?.id ?? null,
          createdById: user.userId,
        },
        include: SHEET_ADVANCE_INCLUDE,
      });

      await this.syncClosedSheet(tx, user.vendorId, dailySheetId);
      return row;
    });

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: sheet.isClosed ? 'CLOSED_SHEET_ADVANCE_ADDED' : 'SHEET_ADVANCE_ADDED',
      entity: 'SheetAdvance',
      entityId: created.id,
      changes: {
        after: {
          dailySheetId,
          employeeId: created.employeeId,
          amount: created.amount,
          notes: created.notes,
          ledgerTwinId: created.staffLedgerEntryId,
        },
        ...(sheet.isClosed && { reason }),
      },
    });

    return created;
  }

  /**
   * Edits an advance in place: the row is rewritten and its payroll twin is voided and
   * re-posted in the SAME transaction (so payroll always mirrors the row; the re-post
   * re-runs the approval gate). Blocked once the twin is rolled into a locked payroll
   * period — payroll figures are frozen history then, so the user deletes + re-records.
   * Optimistic CAS on `version` FIRST, so a stale request fails before any twin is touched.
   */
  async update(user: AuthUser, id: string, dto: UpdateSheetAdvanceDto) {
    const row = await this.prisma.sheetAdvance.findFirst({
      where: { id, vendorId: user.vendorId },
      include: { dailySheet: { select: { isClosed: true, date: true } } },
    });
    if (!row) throw new NotFoundException('Advance not found.');
    if (row.status === SheetAdvanceStatus.VOIDED) throw new BadRequestException('A deleted advance cannot be edited.');

    await this.assertCanManage(user, row);
    const reason = await this.assertClosedSheetAccess(user, row.dailySheet.isClosed, dto.reason);

    const requestedNotes = dto.notes === undefined ? undefined : dto.notes.trim() === '' ? null : dto.notes.trim();
    const employeeChanged = dto.employeeId !== undefined && dto.employeeId !== row.employeeId;
    const amountChanged = dto.amount !== undefined && dto.amount !== row.amount;
    const notesChanged = requestedNotes !== undefined && requestedNotes !== row.notes;
    if (!employeeChanged && !amountChanged && !notesChanged) {
      throw new BadRequestException('Nothing to update — change at least one field.');
    }

    const newEmployeeId = dto.employeeId ?? row.employeeId;
    const newAmount = dto.amount ?? row.amount;
    const newNotes = notesChanged ? (requestedNotes as string | null) : row.notes;

    if (employeeChanged) {
      const employee = await this.prisma.user.findFirst({
        where: { id: newEmployeeId, vendorId: user.vendorId, isActive: true },
        select: { id: true },
      });
      if (!employee) throw new BadRequestException('The selected employee was not found or is inactive.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // 1. CAS on the row FIRST.
      const claim = await tx.sheetAdvance.updateMany({
        where: { id, vendorId: user.vendorId, status: SheetAdvanceStatus.ACTIVE, version: dto.version },
        data: { version: { increment: 1 } },
      });
      if (claim.count === 0) {
        throw new ConflictException(`Version mismatch: expected ${row.version}, received ${dto.version}. Reload and retry.`);
      }

      // 2. Live twin (its own version is the CAS token for the void).
      const twin = await tx.staffLedgerEntry.findFirst({ where: { id: row.staffLedgerEntryId, vendorId: user.vendorId } });
      if (!twin) throw new BadRequestException('The linked payroll ledger entry for this advance could not be found.');
      if (twin.status === LedgerEntryStatus.VOIDED) {
        throw new BadRequestException(
          'The linked payroll ledger entry for this advance is already voided, so it cannot be edited. Delete this advance and record a new one.',
        );
      }
      if (twin.payrollEntryId !== null) throw new BadRequestException(LOCKED_TWIN_MESSAGE);

      // 3. Void the old twin — this service owns it (creator gate / period guard / sheet-advance guard skipped).
      await this.staffLedger.voidEntryTx(
        tx,
        user,
        twin.id,
        { version: twin.version, reason: reason || 'Advance edited from the daily sheet' },
        { skipCreatorCheck: true, skipPeriodGuard: true, skipSheetAdvanceGuard: true },
      );

      // 4. Fresh twin for the corrected employee/amount/notes (re-runs the approval gate — may be PENDING).
      const effectiveDate = await resolveSheetLedgerDate(tx, user.vendorId, row.dailySheet.date);
      const freshTwin = await this.staffLedger.createTx(
        tx,
        user,
        {
          userId: newEmployeeId,
          category: StaffLedgerCategory.ADVANCE,
          amount: -newAmount,
          effectiveDate: effectiveDate.toISOString(),
          description: twinDescription(row.dailySheet.date, newNotes),
        },
        { skipPeriodGuard: true },
      );

      // 5. Rewrite the row and repoint it at the fresh twin (`version` was already bumped by the CAS).
      await tx.sheetAdvance.update({
        where: { id },
        data: {
          employeeId: newEmployeeId,
          amount: newAmount,
          notes: newNotes,
          staffLedgerEntryId: freshTwin.id,
          editCount: { increment: 1 },
          lastEditedAt: new Date(),
        },
      });

      await this.syncClosedSheet(tx, user.vendorId, row.dailySheetId);

      return tx.sheetAdvance.findUniqueOrThrow({ where: { id }, include: SHEET_ADVANCE_INCLUDE });
    });

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    if (employeeChanged) {
      before.employeeId = row.employeeId;
      after.employeeId = updated.employeeId;
    }
    if (amountChanged) {
      before.amount = row.amount;
      after.amount = updated.amount;
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
      action: row.dailySheet.isClosed ? 'CLOSED_SHEET_ADVANCE_CORRECTED' : 'SHEET_ADVANCE_UPDATED',
      entity: 'SheetAdvance',
      entityId: updated.id,
      changes: { before, after, ...(reason && { reason }) },
    });

    return updated;
  }

  /**
   * Soft-deletes (VOIDs) an advance: the row is kept (its twin link must survive for the
   * Cash Ledger exclusion) and the payroll twin is voided — or REVERSED, as a REVERSAL
   * entry dated today flowing into the open payroll period, when payroll already locked
   * it. The cash goes back into the sheet's hand-in figure.
   */
  async remove(user: AuthUser, id: string, dto: RemoveSheetAdvanceDto) {
    const row = await this.prisma.sheetAdvance.findFirst({
      where: { id, vendorId: user.vendorId },
      include: { dailySheet: { select: { isClosed: true } } },
    });
    if (!row) throw new NotFoundException('Advance not found.');
    if (row.status === SheetAdvanceStatus.VOIDED) throw new BadRequestException('This advance is already deleted.');

    await this.assertCanManage(user, row);
    const reason = await this.assertClosedSheetAccess(user, row.dailySheet.isClosed, dto.reason);
    const ledgerReason = reason || 'Advance removed from the daily sheet';

    const updated = await this.prisma.$transaction(async (tx) => {
      // Claim the row first — a concurrent delete fails here before any ledger work.
      const claim = await tx.sheetAdvance.updateMany({
        where: { id, vendorId: user.vendorId, status: SheetAdvanceStatus.ACTIVE },
        data: {
          status: SheetAdvanceStatus.VOIDED,
          voidedById: user.userId,
          voidedAt: new Date(),
          voidReason: ledgerReason,
          version: { increment: 1 },
        },
      });
      if (claim.count === 0) {
        throw new BadRequestException('This advance was already deleted by someone else. Reload and retry.');
      }

      const twin = await tx.staffLedgerEntry.findFirst({ where: { id: row.staffLedgerEntryId, vendorId: user.vendorId } });
      if (!twin) throw new BadRequestException('The linked payroll ledger entry for this advance could not be found.');

      // A twin that is no longer POSTED/PENDING (already voided) has nothing left to undo.
      if (twin.status === LedgerEntryStatus.POSTED && twin.payrollEntryId !== null) {
        await this.staffLedger.reverseTx(
          tx,
          user,
          twin.id,
          { version: twin.version, reason: ledgerReason },
          { skipSheetAdvanceGuard: true },
        );
      } else if (twin.status !== LedgerEntryStatus.VOIDED) {
        await this.staffLedger.voidEntryTx(
          tx,
          user,
          twin.id,
          { version: twin.version, reason: ledgerReason },
          { skipCreatorCheck: true, skipPeriodGuard: true, skipSheetAdvanceGuard: true },
        );
      }

      await this.syncClosedSheet(tx, user.vendorId, row.dailySheetId);

      return tx.sheetAdvance.findUniqueOrThrow({ where: { id }, include: SHEET_ADVANCE_INCLUDE });
    });

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: row.dailySheet.isClosed ? 'CLOSED_SHEET_ADVANCE_VOIDED' : 'SHEET_ADVANCE_VOIDED',
      entity: 'SheetAdvance',
      entityId: updated.id,
      changes: {
        before: { status: row.status, amount: row.amount, employeeId: row.employeeId },
        after: { status: updated.status },
        reason: ledgerReason,
      },
    });

    return updated;
  }
}
