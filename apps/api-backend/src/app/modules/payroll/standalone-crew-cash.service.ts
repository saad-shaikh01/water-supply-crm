import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { LedgerEntryStatus, StaffLedgerCategory, StandaloneCrewCashStatus } from '@prisma/client';
import type { AuthUser } from '@water-supply-crm/types';
import { paginate } from '../../common/helpers/paginate';
import { AuditService } from '../audit/audit.service';
import { StaffLedgerService } from './staff-ledger.service';
import { CreateStandaloneCrewCashDto } from './dto/create-standalone-crew-cash.dto';
import { VoidStandaloneCrewCashDto } from './dto/void-standalone-crew-cash.dto';
import { StandaloneCrewCashQueryDto } from './dto/standalone-crew-cash-query.dto';

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
  ) {}

  async create(user: AuthUser, dto: CreateStandaloneCrewCashDto) {
    const employee = await this.prisma.user.findFirst({
      where: { id: dto.employeeId, vendorId: user.vendorId },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException('Employee not found.');

    const date = dto.date ? new Date(dto.date) : new Date();

    const created = await this.prisma.$transaction(async (tx) => {
      const ledgerEntry = await this.staffLedger.createTx(tx, user, {
        userId: dto.employeeId,
        category: StaffLedgerCategory.CREW_CASH,
        amount: -dto.amount,
        effectiveDate: date.toISOString(),
        description: `Crew Cash (no sheet) — ${dto.category}${dto.notes ? `: ${dto.notes}` : ''}`,
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

    const updated = await this.prisma.$transaction(async (tx) => {
      const ledgerEntry = await tx.staffLedgerEntry.findUniqueOrThrow({ where: { id: row.staffLedgerEntryId } });

      if (ledgerEntry.status === LedgerEntryStatus.POSTED && ledgerEntry.payrollEntryId !== null) {
        await this.staffLedger.reverseTx(tx, user, ledgerEntry.id, { version: ledgerEntry.version, reason: dto.reason });
      } else {
        await this.staffLedger.voidEntryTx(tx, user, ledgerEntry.id, { version: ledgerEntry.version, reason: dto.reason });
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
      changes: { before: { status: row.status }, after: { status: updated.status, voidReason: dto.reason } },
    });

    return updated;
  }
}
