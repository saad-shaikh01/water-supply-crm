import { Injectable } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { CashLedgerPeriodStatus } from '@prisma/client';
import { periodLabelOf } from './cash-ledger-period.util';

/**
 * Prisma-only read side of the accounting periods. Deliberately has NO other
 * dependencies: `VanCashLedgerService` (row lock flags, redirect rule),
 * `CashLedgerPeriodGuard` (write enforcement) and `CashLedgerPeriodService`
 * (close / reopen — which itself calls VanCashLedgerService for the snapshot)
 * all depend on THIS, so there is no provider cycle.
 *
 * A period with no row is OPEN; only CLOSED rows lock anything.
 */
@Injectable()
export class CashLedgerPeriodStore {
  constructor(private readonly prisma: PrismaService) {}

  /** Labels ("YYYY-MM") of every CLOSED period for the vendor (a small set — at most a few per year). */
  async getClosedLabels(vendorId: string): Promise<Set<string>> {
    const rows = await this.prisma.cashLedgerPeriod.findMany({
      where: { vendorId, status: CashLedgerPeriodStatus.CLOSED },
      select: { periodLabel: true },
    });
    return new Set(rows.map((r) => r.periodLabel));
  }

  /** The distinct CLOSED period labels among the given business dates (empty = all writable). */
  async closedLabelsAmong(
    vendorId: string,
    dates: ReadonlyArray<Date | string | null | undefined>,
  ): Promise<string[]> {
    const wanted = new Set<string>();
    for (const d of dates) {
      if (d === null || d === undefined || d === '') continue;
      wanted.add(periodLabelOf(d));
    }
    if (wanted.size === 0) return [];
    const closed = await this.getClosedLabels(vendorId);
    return [...wanted].filter((label) => closed.has(label)).sort();
  }

  /** Is this business date inside a CLOSED period? */
  async isDateClosed(vendorId: string, date: Date | string): Promise<boolean> {
    return (await this.closedLabelsAmong(vendorId, [date])).length > 0;
  }
}
