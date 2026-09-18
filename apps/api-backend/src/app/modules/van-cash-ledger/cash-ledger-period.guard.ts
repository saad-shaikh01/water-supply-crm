import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { AuditService } from '../audit/audit.service';
import { PermissionService } from '../authz/permission.service';
import { getLockOverrideContext } from '../../common/request-context/lock-override.context';
import { CashLedgerPeriodStore } from './cash-ledger-period.store';
import { periodDisplayLabel } from './cash-ledger-period.util';

/** Minimum trimmed length of the reason an admin must give to write into a closed period. */
export const LOCK_OVERRIDE_MIN_REASON = 10;

/**
 * Accounting-period write guard for the Cash Ledger (spec R7).
 *
 * A write dated inside a CLOSED period is rejected (403 `PERIOD_CLOSED`) unless
 * the caller holds `van_cash_ledger:override_lock` AND supplies a reason of at
 * least 10 characters (header `X-Lock-Override-Reason`, read from the request's
 * AsyncLocalStorage context — see `common/request-context/lock-override.context.ts`
 * — or passed explicitly via `opts`). A permitted override is counted on the
 * period row and written to the audit log (`LOCK_OVERRIDE`).
 *
 * Contract for callers (P2 already follows it — no call-site changes in P4):
 *   - pass EVERY business date the write affects — for an edit that is BOTH the
 *     old and the new date (moving an entry across a period boundary is a write
 *     into both periods);
 *   - call it BEFORE mutating anything, inside or outside the transaction;
 *   - never catch/swallow its rejection.
 *
 * Outside an HTTP request (scripts, BullMQ jobs) there is no ALS context and no
 * `opts.userId`, so nothing can override: system writers can never write into a
 * closed period (they use the redirect rule to the current period instead).
 */
@Injectable()
export class CashLedgerPeriodGuard {
  constructor(
    private readonly store: CashLedgerPeriodStore,
    private readonly permissions: PermissionService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async assertWritable(
    vendorId: string,
    dates: ReadonlyArray<Date | string | null | undefined>,
    opts?: { overrideReason?: string | null; userId?: string },
  ): Promise<void> {
    const closed = await this.store.closedLabelsAmong(vendorId, dates);
    if (closed.length === 0) return;

    const ctx = getLockOverrideContext();
    // `req.user` is populated by the JWT guard AFTER the middleware created the
    // store, so it is read lazily here (same source `@CurrentUser()` uses).
    const userId: string | undefined = opts?.userId ?? ctx?.req?.user?.userId ?? undefined;
    const rawReason = opts?.overrideReason ?? ctx?.overrideReason ?? null;
    const reason = typeof rawReason === 'string' ? rawReason.trim() : '';

    const canOverride = !!userId && (await this.permissions.can(userId, 'van_cash_ledger:override_lock'));
    const reasonOk = reason.length >= LOCK_OVERRIDE_MIN_REASON;

    if (!canOverride || !reasonOk) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'PERIOD_CLOSED',
        message: buildMessage(closed, canOverride),
        periods: closed,
        canOverride,
      });
    }

    // Allowed: count it on every touched closed period and leave an audit trail.
    const now = new Date();
    const isoDates = dates
      .filter((d): d is Date | string => d !== null && d !== undefined && d !== '')
      .map((d) => (d instanceof Date ? d.toISOString() : String(d)));
    const rows = await this.prisma.cashLedgerPeriod.findMany({
      where: { vendorId, periodLabel: { in: closed } },
      select: { id: true, periodLabel: true },
    });
    const idByLabel = new Map(rows.map((r) => [r.periodLabel, r.id]));

    for (const periodLabel of closed) {
      await this.prisma.cashLedgerPeriod.updateMany({
        where: { vendorId, periodLabel },
        data: { overrideCount: { increment: 1 }, lastOverrideAt: now },
      });
      await this.audit.log({
        vendorId,
        userId,
        action: 'LOCK_OVERRIDE',
        entity: 'CashLedgerPeriod',
        entityId: idByLabel.get(periodLabel),
        changes: { after: { periods: closed, dates: isoDates }, reason },
      });
    }
  }
}

function buildMessage(closed: string[], canOverride: boolean): string {
  const names = closed.map(periodDisplayLabel).join(', ');
  const base = `This entry belongs to a closed accounting period (${names}).`;
  return canOverride
    ? `${base} To write into it anyway, provide a reason (min ${LOCK_OVERRIDE_MIN_REASON} characters) to override.`
    : `${base} Ask an admin to make this change, or date it in the current period.`;
}

