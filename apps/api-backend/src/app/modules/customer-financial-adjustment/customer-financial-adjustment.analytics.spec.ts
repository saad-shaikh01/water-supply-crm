import { AnalyticsService } from '../analytics/analytics.service';

/**
 * Company-loss report (AnalyticsService.getCustomers → `companyLosses`) with Customer
 * Financial Adjustment WRITE_OFFs.
 *
 * The report reads `Transaction` rows of type ADJUSTMENT. Two things had to change:
 *  - new WRITE_OFF rows carry the neutral text "Account adjustment", so they must be found
 *    by their adjustment (kind WRITE_OFF, status POSTED) and classified as BALANCE
 *    write-offs by `adjustmentId`, not by text;
 *  - the legacy text match ("company loss") must exclude adjustment-backed rows, or a
 *    staff-typed title containing those words would be counted as a loss.
 *
 * Filtering happens in Postgres, so this spec CAPTURES the `where` the service actually
 * sends and evaluates it against fixture rows with a small model of the Prisma operators
 * involved (equality, null, contains, is, OR, date bounds). It proves what the real query
 * selects under Prisma's documented semantics — not just its shape — but it is not a
 * substitute for one run against a real database.
 */

const VENDOR_ID = 'vendor-1';

const CUSTOMER = { name: 'Ali Traders', customerCode: 'C-101' };
const row = (over: Record<string, unknown>): Record<string, any> => ({
  vendorId: VENDOR_ID,
  type: 'ADJUSTMENT',
  customerId: 'cust-1',
  customer: CUSTOMER,
  product: null,
  amount: 0,
  bottleCount: null,
  adjustmentId: null,
  adjustment: null,
  createdAt: new Date('2026-09-15T10:00:00.000Z'),
  ...over,
});

const ROWS = [
  // ── belongs in the report ──
  row({ id: 'legacy-balance', description: 'Bad-debt write-off on account closure — company loss (force deactivate by Admin)', amount: -2000 }),
  row({ id: 'legacy-bottles', description: 'Bottle write-off on account closure — company loss (force deactivate by Admin) — Bottle 19L: 3', bottleCount: -3, product: { name: 'Bottle 19L' } }),
  row({ id: 'new-writeoff', description: 'Account adjustment', amount: -400, adjustmentId: 'adj-w1', adjustment: { kind: 'WRITE_OFF', status: 'POSTED' } }),
  // ── must NOT be in the report ──
  row({ id: 'voided-writeoff', description: 'Account adjustment', amount: -250, adjustmentId: 'adj-w2', adjustment: { kind: 'WRITE_OFF', status: 'VOIDED' } }),
  row({ id: 'its-reversal', description: 'Account adjustment reversal', amount: 250, adjustmentId: 'adj-r2', adjustment: { kind: 'REVERSAL', status: 'POSTED' } }),
  row({ id: 'polluter-penalty', description: 'Damage - company loss review', amount: 500, adjustmentId: 'adj-p1', adjustment: { kind: 'PENALTY', status: 'POSTED' } }),
  row({ id: 'correction', description: 'Account adjustment', amount: -100, adjustmentId: 'adj-c1', adjustment: { kind: 'CORRECTION', status: 'POSTED' } }),
  row({ id: 'damage-charge', description: 'Lost bottle charge – case #1', amount: 300 }),
  row({ id: 'other-vendor', vendorId: 'vendor-2', description: 'Account adjustment', amount: -900, adjustmentId: 'adj-x', adjustment: { kind: 'WRITE_OFF', status: 'POSTED' } }),
];

/** A small model of the Prisma where-operators this query uses. */
function matches(r: any, where: Record<string, any>): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as any[]).some((w) => matches(r, w));
    const cell = r[key];
    if (cond === null) return cell === null || cell === undefined;
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('is' in cond) return cell != null && matches(cell, cond.is);
      if ('contains' in cond) return typeof cell === 'string' && cell.includes(cond.contains);
      if ('gte' in cond || 'lte' in cond) {
        return (!cond.gte || cell >= cond.gte) && (!cond.lte || cell <= cond.lte);
      }
      if ('in' in cond) return (cond.in as unknown[]).includes(cell);
    }
    return cell === cond;
  });
}

function build() {
  const captured: { where?: any; select?: any } = {};
  const prisma = {
    customer: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
    auditLog: { count: jest.fn(async () => 0) },
    transaction: {
      groupBy: jest.fn(async () => []),
      findMany: jest.fn(async (args: any) => {
        captured.where = args.where;
        captured.select = args.select;
        return ROWS.filter((r) => matches(r, args.where));
      }),
    },
  };
  const cache = {
    vendorKey: (v: string, k: string) => `${v}:${k}`,
    get: jest.fn(async () => null),
    set: jest.fn(async () => undefined),
  };
  const service = new AnalyticsService(prisma as any, cache as any, {} as any);
  return { service, prisma, captured };
}

describe('company-loss report with WRITE_OFF adjustments', () => {
  describe('the query it sends', () => {
    it('unions the legacy text match (adjustment-free rows only) with POSTED WRITE_OFF adjustments', async () => {
      const { service, captured } = build();
      await service.getCustomers(VENDOR_ID);

      expect(captured.where).toMatchObject({ vendorId: VENDOR_ID, type: 'ADJUSTMENT' });
      expect(captured.where.OR).toEqual([
        { description: { contains: 'company loss' }, adjustmentId: null },
        { adjustment: { is: { kind: 'WRITE_OFF', status: 'POSTED' } } },
      ]);
    });

    it('no longer applies the bare text filter on its own (the pollution hole)', async () => {
      const { service, captured } = build();
      await service.getCustomers(VENDOR_ID);
      expect('description' in captured.where).toBe(false);
    });

    it('selects adjustmentId so rows can be classified without relying on their text', async () => {
      const { service, captured } = build();
      await service.getCustomers(VENDOR_ID);
      expect(captured.select.adjustmentId).toBe(true);
    });

    it('keeps the date filter alongside the union (AND, not inside the OR)', async () => {
      const { service, captured } = build();
      await service.getCustomers(VENDOR_ID, '2026-09-01', '2026-09-30');
      expect(captured.where.createdAt).toBeDefined();
      expect(captured.where.OR).toHaveLength(2);
    });
  });

  describe('what that query selects, and how the report counts it', () => {
    it('selects exactly the legacy rows and the POSTED write-off', async () => {
      const { service, prisma } = build();
      await service.getCustomers(VENDOR_ID);
      const returned = await (prisma.transaction.findMany as jest.Mock).mock.results[0].value;
      expect(returned.map((r: any) => r.id).sort()).toEqual(['legacy-balance', 'legacy-bottles', 'new-writeoff']);
    });

    it('a voided write-off drops out, and so does its reversal — a void nets the loss to zero', async () => {
      const { service, prisma } = build();
      await service.getCustomers(VENDOR_ID);
      const ids = (await (prisma.transaction.findMany as jest.Mock).mock.results[0].value).map((r: any) => r.id);
      expect(ids).not.toContain('voided-writeoff');
      expect(ids).not.toContain('its-reversal');
    });

    it('a staff-typed title containing "company loss" is NOT a loss (the old filter counted it)', async () => {
      const { service, prisma } = build();
      const polluter = ROWS.find((r) => r.id === 'polluter-penalty')!;

      // The pre-change filter WOULD have selected it (and misfiled it as a bottle write-off):
      expect(matches(polluter, { description: { contains: 'company loss' } })).toBe(true);

      await service.getCustomers(VENDOR_ID);
      const ids = (await (prisma.transaction.findMany as jest.Mock).mock.results[0].value).map((r: any) => r.id);
      expect(ids).not.toContain('polluter-penalty');
    });

    it('corrections, other damage charges and other vendors\' write-offs are not counted', async () => {
      const { service, prisma } = build();
      await service.getCustomers(VENDOR_ID);
      const ids = (await (prisma.transaction.findMany as jest.Mock).mock.results[0].value).map((r: any) => r.id);
      for (const excluded of ['correction', 'damage-charge', 'other-vendor']) expect(ids).not.toContain(excluded);
    });

    it('totals: legacy balance + new write-off are BALANCE losses; legacy bottles are BOTTLE losses', async () => {
      const { service } = build();
      const { companyLosses } = await service.getCustomers(VENDOR_ID);

      expect(companyLosses.balanceWriteOffTotal).toBe(2400); // 2000 legacy + 400 new
      expect(companyLosses.bottleWriteOffTotal).toBe(3);
    });

    it('a new write-off is classified BALANCE by its adjustment, not misfiled as a 0-bottle write-off', async () => {
      const { service } = build();
      const { companyLosses } = await service.getCustomers(VENDOR_ID);

      const newRow = companyLosses.details.find((d: any) => d.id === 'new-writeoff');
      expect(newRow).toMatchObject({ type: 'BALANCE', amount: 400, bottleCount: 0, customerName: 'Ali Traders', customerCode: 'C-101' });

      const legacyBottles = companyLosses.details.find((d: any) => d.id === 'legacy-bottles');
      expect(legacyBottles).toMatchObject({ type: 'BOTTLES', amount: 0, bottleCount: 3, product: 'Bottle 19L' });
    });

    it('the report never exposes the ledger text of an adjustment write-off (the detail rows carry no description)', async () => {
      const { service } = build();
      const { companyLosses } = await service.getCustomers(VENDOR_ID);
      for (const d of companyLosses.details) expect('description' in d).toBe(false);
    });
  });

  it('with no write-offs at all, the report is empty rather than erroring', async () => {
    const { service, prisma } = build();
    (prisma.transaction.findMany as jest.Mock).mockResolvedValueOnce([]);
    const { companyLosses } = await service.getCustomers(VENDOR_ID);
    expect(companyLosses).toEqual({ balanceWriteOffTotal: 0, bottleWriteOffTotal: 0, details: [] });
  });
});
