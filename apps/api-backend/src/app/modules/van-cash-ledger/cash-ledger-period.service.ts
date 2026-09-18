import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import {
  CashLedgerPeriodStatus,
  FuelCardTopUpStatus,
  LedgerEntryStatus,
  ManualCashInStatus,
  OfficeCashRemittanceStatus,
  Prisma,
  SettlementMethod,
  StaffLedgerCategory,
  StandaloneCrewCashStatus,
  VanCashHandoverStatus,
} from '@prisma/client';
import type { AuthUser } from '@water-supply-crm/types';
import { AuditService } from '../audit/audit.service';
import { PermissionService } from '../authz/permission.service';
import type {
  CashLedgerPeriodCloseCheck,
  CashLedgerPeriodInfo,
  CashLedgerPeriodsResponse,
  PeriodCheckItem,
} from './cash-ledger-contract';
import { CashLedgerPeriodStore } from './cash-ledger-period.store';
import {
  currentPeriodLabel,
  hasPeriodEnded,
  isPeriodLabel,
  nextPeriodLabel,
  periodBounds,
  periodDisplayLabel,
  periodLabelOf,
  previousPeriodLabel,
} from './cash-ledger-period.util';
import { VanCashLedgerService } from './van-cash-ledger.service';

/** Most periods the list endpoint returns (newest first). */
export const MAX_LISTED_PERIODS = 24;
/** Live closing balances are computed for every CLOSED period plus this many of the newest OPEN ones. */
const LIVE_BALANCE_OPEN_CAP = 2;
/** Safety bound on the month walk of the sequential-close rule. */
const MAX_MONTH_WALK = 600;

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

interface PeriodRow {
  id: string;
  periodLabel: string;
  status: CashLedgerPeriodStatus;
  closedAt: Date | null;
  closedById: string | null;
  closeNote: string | null;
  closingBalance: number | null;
  reopenedAt: Date | null;
  reopenedById: string | null;
  reopenReason: string | null;
  reopenCount: number;
  overrideCount: number;
  lastOverrideAt: Date | null;
}

/**
 * Accounting periods (P4): list / close-check / close / reopen.
 *
 * A period is a PKT calendar month. A period with NO row is OPEN — rows are
 * created on first close and KEPT on reopen (history: reopenCount, reason...).
 * Depends on `CashLedgerPeriodStore` (Prisma-only) rather than the guard so
 * there is no provider cycle with `VanCashLedgerService`.
 */
@Injectable()
export class CashLedgerPeriodService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: CashLedgerPeriodStore,
    private readonly vanCashLedger: VanCashLedgerService,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
  ) {}

  // ── list ──────────────────────────────────────────────────────────────────

  async list(user: AuthUser): Promise<CashLedgerPeriodsResponse> {
    const vendorId = user.vendorId;
    const now = new Date();
    const currentLabel = currentPeriodLabel(now);

    const [earliest, rows, canClose, canOverride] = await Promise.all([
      this.earliestActivityLabel(vendorId),
      this.prisma.cashLedgerPeriod.findMany({ where: { vendorId } }) as Promise<PeriodRow[]>,
      this.permissions.can(user.userId, 'van_cash_ledger:close_period'),
      this.permissions.can(user.userId, 'van_cash_ledger:override_lock'),
    ]);

    const rowByLabel = new Map(rows.map((r) => [r.periodLabel, r]));
    const closedLabels = new Set(
      rows.filter((r) => r.status === CashLedgerPeriodStatus.CLOSED).map((r) => r.periodLabel),
    );

    // Current month back to the earliest activity (or the oldest row), max 24.
    const lowest = [currentLabel, earliest, ...rows.map((r) => r.periodLabel)]
      .filter((l): l is string => !!l && l <= currentLabel)
      .sort()[0];
    const labels: string[] = [];
    for (let l = currentLabel; l >= lowest && labels.length < MAX_LISTED_PERIODS; l = previousPeriodLabel(l)) {
      labels.push(l);
    }

    // Live balances: every CLOSED period + the newest N OPEN ones.
    const liveTargets: string[] = [];
    let openSeen = 0;
    for (const label of labels) {
      if (closedLabels.has(label)) {
        liveTargets.push(label);
      } else if (openSeen < LIVE_BALANCE_OPEN_CAP) {
        liveTargets.push(label);
        openSeen += 1;
      }
    }
    const liveEntries = await Promise.all(
      liveTargets.map(
        async (label) =>
          [label, await this.vanCashLedger.getClosingBalanceAsOf(vendorId, periodBounds(label).lastDay)] as const,
      ),
    );
    const liveByLabel = new Map(liveEntries);

    const names = await this.loadNames(
      labels.flatMap((l) => {
        const r = rowByLabel.get(l);
        return r ? [r.closedById, r.reopenedById] : [];
      }),
    );

    const periods = labels.map((label) =>
      this.toInfo(label, rowByLabel.get(label) ?? null, {
        names,
        // Older OPEN periods beyond the cap fall back to 0 (documented gap).
        live: liveByLabel.get(label) ?? 0,
        closedLabels,
        currentLabel,
        now,
      }),
    );

    return { currentLabel, periods, permissions: { canClose, canOverride } };
  }

  // ── close-check ─────────────────────────────────────────────────────────────

  async closeCheck(vendorId: string, label: string): Promise<CashLedgerPeriodCloseCheck> {
    this.assertLabel(label);
    const now = new Date();
    const { startDate, endDate, firstDay, lastDay } = periodBounds(label);
    const inPeriod = { gte: startDate, lte: endDate };

    const [row, earliest, closedLabels, handovers, remittances, openSheets, advances, statement] = await Promise.all([
      this.prisma.cashLedgerPeriod.findFirst({ where: { vendorId, periodLabel: label } }) as Promise<PeriodRow | null>,
      this.earliestActivityLabel(vendorId),
      this.store.getClosedLabels(vendorId),
      this.prisma.vanCashHandover.aggregate({
        where: { vendorId, status: VanCashHandoverStatus.PENDING, date: inPeriod },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.officeCashRemittance.aggregate({
        where: { vendorId, status: OfficeCashRemittanceStatus.PENDING, date: inPeriod },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.dailySheet.count({ where: { vendorId, isClosed: false, date: inPeriod } }),
      this.prisma.staffLedgerEntry.aggregate({
        where: {
          vendorId,
          category: StaffLedgerCategory.ADVANCE,
          status: LedgerEntryStatus.PENDING,
          effectiveDate: inPeriod,
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.vanCashLedger.getStatementForRange(vendorId, firstDay, lastDay),
    ]);

    const status: 'OPEN' | 'CLOSED' = row?.status === CashLedgerPeriodStatus.CLOSED ? 'CLOSED' : 'OPEN';
    const display = periodDisplayLabel(label);
    const blockers: PeriodCheckItem[] = [];
    const warnings: PeriodCheckItem[] = [];

    if (!hasPeriodEnded(label, now)) {
      blockers.push({
        code: 'PERIOD_NOT_ENDED',
        message: `${display} has not ended yet - it can be closed from ${nextPeriodLabel(label)}-01.`,
        count: 1,
      });
    }
    if (status === 'CLOSED') {
      blockers.push({ code: 'ALREADY_CLOSED', message: `${display} is already closed.`, count: 1 });
    }

    // Sequential rule: every earlier month from the first ledger activity on must be closed first.
    if (earliest && earliest < label) {
      const open: string[] = [];
      let l = earliest;
      for (let i = 0; l < label && i < MAX_MONTH_WALK; i += 1, l = nextPeriodLabel(l)) {
        if (!closedLabels.has(l)) open.push(l);
      }
      if (open.length > 0) {
        blockers.push({
          code: 'PREVIOUS_PERIOD_OPEN',
          message: `${periodDisplayLabel(open[0])} is still open - close periods in order, oldest first.`,
          count: open.length,
        });
      }
    }

    const pendingHandoverCount = handovers._count?._all ?? 0;
    if (pendingHandoverCount > 0) {
      blockers.push({
        code: 'PENDING_HANDOVERS',
        message: `${pendingHandoverCount} cash handover(s) dated in ${display} are still pending approval.`,
        count: pendingHandoverCount,
        amount: round2(handovers._sum?.amount ?? 0),
      });
    }
    const pendingRemittanceCount = remittances._count?._all ?? 0;
    if (pendingRemittanceCount > 0) {
      blockers.push({
        code: 'PENDING_REMITTANCES',
        message: `${pendingRemittanceCount} office cash transfer(s) dated in ${display} are still pending approval.`,
        count: pendingRemittanceCount,
        amount: round2(remittances._sum?.amount ?? 0),
      });
    }

    if (openSheets > 0) {
      warnings.push({
        code: 'OPEN_SHEETS',
        message: `${openSheets} daily sheet(s) in ${display} are not closed yet - their cash is not in the ledger.`,
        count: openSheets,
      });
    }
    const pendingAdvanceCount = advances._count?._all ?? 0;
    if (pendingAdvanceCount > 0) {
      warnings.push({
        code: 'PENDING_ADVANCES',
        message: `${pendingAdvanceCount} staff advance(s) dated in ${display} are still pending - their cash is not in the ledger.`,
        count: pendingAdvanceCount,
        amount: round2(Math.abs(advances._sum?.amount ?? 0)),
      });
    }
    if (statement.expectedClosing < 0) {
      warnings.push({
        code: 'NEGATIVE_BALANCE',
        message: `The office cash balance closes ${display} negative - check for missing cash-in entries.`,
        count: 1,
        amount: round2(statement.expectedClosing),
      });
    }
    if ((row?.reopenCount ?? 0) > 0) {
      warnings.push({
        code: 'REOPENED_BEFORE',
        message: `${display} has been reopened ${row?.reopenCount} time(s) before.`,
        count: row?.reopenCount ?? 0,
      });
    }

    return {
      label,
      displayLabel: display,
      firstDay,
      lastDay,
      status,
      canClose: blockers.length === 0,
      blockers,
      warnings,
      statement,
    };
  }

  // ── close ───────────────────────────────────────────────────────────────────

  async close(
    user: AuthUser,
    label: string,
    dto: { note?: string; acknowledgeWarnings?: boolean } = {},
  ): Promise<CashLedgerPeriodInfo> {
    const vendorId = user.vendorId;
    const check = await this.closeCheck(vendorId, label);
    const display = check.displayLabel;

    if (check.status === 'CLOSED') {
      throw new ConflictException({
        statusCode: 409,
        code: 'PERIOD_ALREADY_CLOSED',
        message: `${display} is already closed.`,
      });
    }
    if (check.blockers.length > 0) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'PERIOD_CLOSE_BLOCKED',
        message: `${display} cannot be closed yet: ${check.blockers.map((b) => b.message).join(' ')}`,
        blockers: check.blockers,
      });
    }
    // REOPENED_BEFORE is informational only — every other warning needs an explicit acknowledgement.
    if (check.warnings.some((w) => w.code !== 'REOPENED_BEFORE') && !dto.acknowledgeWarnings) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'WARNINGS_UNACKNOWLEDGED',
        message: `${display} has warnings that must be acknowledged before closing.`,
        warnings: check.warnings,
      });
    }

    const { startDate, endDate, lastDay } = periodBounds(label);
    const closingBalance = round2(await this.vanCashLedger.getClosingBalanceAsOf(vendorId, lastDay));
    const closedAt = new Date();
    const note = dto.note?.trim() ? dto.note.trim() : null;
    const snapshotJson = {
      statement: check.statement,
      closingBalance,
      closedAt: closedAt.toISOString(),
    } as unknown as Prisma.InputJsonValue;
    const data = {
      status: CashLedgerPeriodStatus.CLOSED,
      closedAt,
      closedById: user.userId,
      closeNote: note,
      closingBalance,
      snapshotJson,
      startDate,
      endDate,
    };
    const raced = () =>
      new ConflictException({
        statusCode: 409,
        code: 'PERIOD_ALREADY_CLOSED',
        message: `${display} was closed by someone else just now.`,
      });

    let row: PeriodRow;
    try {
      row = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.cashLedgerPeriod.findFirst({ where: { vendorId, periodLabel: label } });
        if (!existing) {
          return (await tx.cashLedgerPeriod.create({ data: { vendorId, periodLabel: label, ...data } })) as PeriodRow;
        }
        // CAS: only an OPEN row may be closed — a concurrent close loses.
        const res = await tx.cashLedgerPeriod.updateMany({
          where: { id: existing.id, vendorId, status: CashLedgerPeriodStatus.OPEN },
          data,
        });
        if (res.count === 0) throw raced();
        return (await tx.cashLedgerPeriod.findFirst({ where: { id: existing.id } })) as PeriodRow;
      });
    } catch (err) {
      // Two concurrent first-closes race on the (vendorId, periodLabel) unique index.
      if ((err as { code?: string })?.code === 'P2002') throw raced();
      throw err;
    }

    await this.audit.log({
      vendorId,
      userId: user.userId,
      action: 'PERIOD_CLOSED',
      entity: 'CashLedgerPeriod',
      entityId: row.id,
      changes: { after: { label, closingBalance }, ...(note ? { reason: note } : {}) },
    });

    return this.describeOne(vendorId, label, row, closingBalance);
  }

  // ── reopen ──────────────────────────────────────────────────────────────────

  async reopen(user: AuthUser, label: string, dto: { reason: string }): Promise<CashLedgerPeriodInfo> {
    this.assertLabel(label);
    const vendorId = user.vendorId;
    const reason = (dto?.reason ?? '').trim();
    if (reason.length < 10) {
      throw new BadRequestException('A reason of at least 10 characters is required to reopen a period.');
    }
    const display = periodDisplayLabel(label);

    const [row, closedLabels] = await Promise.all([
      this.prisma.cashLedgerPeriod.findFirst({ where: { vendorId, periodLabel: label } }) as Promise<PeriodRow | null>,
      this.store.getClosedLabels(vendorId),
    ]);
    if (!row || row.status !== CashLedgerPeriodStatus.CLOSED) {
      throw new BadRequestException(`${display} is not closed.`);
    }
    const later = [...closedLabels].filter((l) => l > label).sort();
    if (later.length > 0) {
      const latest = later[later.length - 1];
      throw new BadRequestException(
        `Only the most recent closed period can be reopened - reopen ${periodDisplayLabel(latest)} first.`,
      );
    }

    const reopenedAt = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.cashLedgerPeriod.updateMany({
        where: { id: row.id, vendorId, status: CashLedgerPeriodStatus.CLOSED },
        data: {
          status: CashLedgerPeriodStatus.OPEN,
          reopenedAt,
          reopenedById: user.userId,
          reopenReason: reason,
          reopenCount: { increment: 1 },
        },
      });
      if (res.count === 0) {
        throw new ConflictException({
          statusCode: 409,
          code: 'PERIOD_STATE_CHANGED',
          message: `${display} was changed by someone else just now - refresh and try again.`,
        });
      }
      return (await tx.cashLedgerPeriod.findFirst({ where: { id: row.id } })) as PeriodRow;
    });

    await this.audit.log({
      vendorId,
      userId: user.userId,
      action: 'PERIOD_REOPENED',
      entity: 'CashLedgerPeriod',
      entityId: row.id,
      changes: {
        before: { status: 'CLOSED', closingBalance: row.closingBalance },
        after: { status: 'OPEN', reopenCount: updated.reopenCount },
        reason,
      },
    });

    const live = await this.vanCashLedger.getClosingBalanceAsOf(vendorId, periodBounds(label).lastDay);
    return this.describeOne(vendorId, label, updated, live);
  }

  // ── helpers ─────────────────────────────────────────────────────────────────

  private assertLabel(label: string): void {
    if (!isPeriodLabel(label)) throw new BadRequestException('Period label must look like YYYY-MM.');
  }

  /** The earliest month ("YYYY-MM") with ANY ledger activity across the cash sources, or null when there is none. */
  async earliestActivityLabel(vendorId: string): Promise<string | null> {
    const [handover, manual, expense, advance, settlement, remittance, fuelCard, crewCash] = await Promise.all([
      this.prisma.vanCashHandover.aggregate({ where: { vendorId }, _min: { date: true } }),
      this.prisma.vanCashOpeningBalance.aggregate({
        where: { vendorId, status: ManualCashInStatus.ACTIVE },
        _min: { openingDate: true },
      }),
      this.prisma.expense.aggregate({
        where: { vendorId, paidFromCash: true, dailySheetId: null },
        _min: { date: true },
      }),
      this.prisma.staffLedgerEntry.aggregate({
        where: { vendorId, category: StaffLedgerCategory.ADVANCE, amount: { lt: 0 } },
        _min: { effectiveDate: true },
      }),
      this.prisma.settlement.aggregate({
        where: { vendorId, method: SettlementMethod.CASH },
        _min: { paidAt: true },
      }),
      this.prisma.officeCashRemittance.aggregate({ where: { vendorId }, _min: { date: true } }),
      this.prisma.fuelCardTopUp.aggregate({
        where: { vendorId, status: FuelCardTopUpStatus.ACTIVE },
        _min: { date: true },
      }),
      this.prisma.standaloneCrewCashExpense.aggregate({
        where: { vendorId, status: StandaloneCrewCashStatus.ACTIVE },
        _min: { date: true },
      }),
    ]);
    const mins = [
      handover._min?.date,
      manual._min?.openingDate,
      expense._min?.date,
      advance._min?.effectiveDate,
      settlement._min?.paidAt,
      remittance._min?.date,
      fuelCard._min?.date,
      crewCash._min?.date,
    ].filter((d): d is Date => d instanceof Date);
    if (mins.length === 0) return null;
    return mins.map((d) => periodLabelOf(d)).sort()[0];
  }

  private async loadNames(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    if (unique.length === 0) return new Map();
    const users = await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
    return new Map(users.map((u) => [u.id, u.name]));
  }

  /** Builds the single-period response used by close / reopen. */
  private async describeOne(vendorId: string, label: string, row: PeriodRow, live: number): Promise<CashLedgerPeriodInfo> {
    const now = new Date();
    const [names, closedLabels] = await Promise.all([
      this.loadNames([row.closedById, row.reopenedById]),
      this.store.getClosedLabels(vendorId),
    ]);
    return this.toInfo(label, row, { names, live, closedLabels, currentLabel: currentPeriodLabel(now), now });
  }

  private toInfo(
    label: string,
    row: PeriodRow | null,
    ctx: { names: Map<string, string>; live: number; closedLabels: Set<string>; currentLabel: string; now: Date },
  ): CashLedgerPeriodInfo {
    const { firstDay, lastDay } = periodBounds(label);
    const closed = row?.status === CashLedgerPeriodStatus.CLOSED;
    const closingBalance = closed && row?.closingBalance != null ? row.closingBalance : null;
    const live = round2(ctx.live);
    return {
      label,
      displayLabel: periodDisplayLabel(label),
      firstDay,
      lastDay,
      status: closed ? 'CLOSED' : 'OPEN',
      isCurrent: label === ctx.currentLabel,
      hasEnded: hasPeriodEnded(label, ctx.now),
      closedAt: row?.closedAt ? row.closedAt.toISOString() : null,
      closedByName: row?.closedById ? (ctx.names.get(row.closedById) ?? null) : null,
      closeNote: row?.closeNote ?? null,
      reopenedAt: row?.reopenedAt ? row.reopenedAt.toISOString() : null,
      reopenedByName: row?.reopenedById ? (ctx.names.get(row.reopenedById) ?? null) : null,
      reopenReason: row?.reopenReason ?? null,
      reopenCount: row?.reopenCount ?? 0,
      overrideCount: row?.overrideCount ?? 0,
      lastOverrideAt: row?.lastOverrideAt ? row.lastOverrideAt.toISOString() : null,
      closingBalance,
      liveClosingBalance: live,
      drift: closingBalance !== null ? round2(live - closingBalance) : null,
      canReopen: closed && ![...ctx.closedLabels].some((l) => l > label),
    };
  }
}
