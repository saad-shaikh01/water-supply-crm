import { CustomerService } from '../customer/customer.service';
import { CustomerStatementPdfService } from '../customer/pdf/customer-statement-pdf.service';
import { resolveAdjustmentEffectiveDate } from './adjustment-posting.util';

/**
 * Minimum statement verification for Customer Financial Adjustments.
 *
 * Runs the REAL statement derivation (CustomerService.getMonthlyStatementData →
 * getMonthlyStatement + CustomerStatementPdfService.buildRows) over a fixture ledger that
 * spans three months. No statement code was changed for this feature; these tests prove
 * that adjustment ledger rows — charges, credits, a write-off and a voided pair — already
 * flow through it with correct opening / closing / running balances.
 *
 * Fixture dates are built with LOCAL-time constructors because the statement's month
 * windows are cut at the server's local midnight (`new Date(year, month, 1)`); that keeps
 * these tests correct on any runner timezone.
 */

const VENDOR_ID = 'vendor-1';
const CUSTOMER_ID = 'customer-1';
const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0, 0);

interface Row {
  id: string;
  type: 'DELIVERY' | 'PAYMENT' | 'ADJUSTMENT';
  amount: number;
  description: string;
  createdAt: Date;
  adjustmentId?: string | null;
}

let n = 0;
const delivery = (createdAt: Date, amount: number): Row & Record<string, unknown> => ({
  id: `txn-delivery-${++n}-abcdef`,
  type: 'DELIVERY',
  amount,
  description: 'Delivered 10, Received 0',
  createdAt,
  productId: 'p1',
  product: { name: 'Bottle 19L', basePrice: 100 },
  filledDropped: 10,
  emptyReceived: 0,
  filledReceived: 0,
  dailySheetItemId: null,
  dailySheetItem: null,
});
const adjustment = (createdAt: Date, amount: number, description: string): Row & Record<string, unknown> => ({
  id: `txn-adjustment-${++n}-abcdef`,
  type: 'ADJUSTMENT',
  amount,
  description,
  createdAt,
  adjustmentId: `adj-${n}`,
  productId: null,
  product: null,
  dailySheetItemId: null,
  dailySheetItem: null,
});
const payment = (createdAt: Date, amount: number): Row & Record<string, unknown> => ({
  id: `txn-payment-${++n}-abcdef`,
  type: 'PAYMENT',
  amount: -amount,
  description: 'Payment received',
  createdAt,
  adjustmentId: null,
  productId: null,
  product: null,
  dailySheetItemId: null,
  dailySheetItem: null,
});

/**
 * A customer's whole ledger. The wording on each adjustment row is what the posting
 * service writes: ITEMIZED = the title; SUMMARIZED (write-off) = the neutral label; and a
 * void = an equal-and-opposite REVERSAL row dated the void day.
 */
const LEDGER = [
  // ── August ──
  delivery(at(2026, 8, 10), 1000),
  adjustment(at(2026, 8, 20), 300, 'Installation charge'),
  // ── September ──
  adjustment(at(2026, 9, 5), 500, 'Late payment penalty'),
  payment(at(2026, 9, 10), 200),
  adjustment(at(2026, 9, 12), -100, 'Loyalty discount'),
  adjustment(at(2026, 9, 15), -150, 'Account adjustment'), // WRITE_OFF, SUMMARIZED
  adjustment(at(2026, 9, 20), -500, 'Reversal: Late payment penalty'), // void of the 5 Sept penalty
  // ── October ──
  delivery(at(2026, 10, 3), 400),
];
const LIVE_BALANCE = LEDGER.reduce((sum, r) => sum + r.amount, 0); // 1250

function buildService() {
  const inWindow = (d: Date, w?: { gte?: Date; lt?: Date }) =>
    (!w?.gte || d >= w.gte) && (!w?.lt || d < w.lt);

  const prisma = {
    customer: {
      findFirst: jest.fn(async () => ({
        id: CUSTOMER_ID,
        vendorId: VENDOR_ID,
        name: 'Test Customer',
        customerCode: 'C-001',
        address: 'Street 1',
        phoneNumber: '923001234567',
        paymentType: 'MONTHLY',
        financialBalance: LIVE_BALANCE,
        customPrices: [],
      })),
    },
    transaction: {
      // Called twice by getMonthlyStatement: the period rows, and "everything after the period".
      findMany: jest.fn(async (args: any) =>
        LEDGER.filter((r) => inWindow(r.createdAt, args.where.createdAt)).sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
        ),
      ),
      findFirst: jest.fn(async () => null),
    },
  };
  const service = new CustomerService(
    prisma as any,
    {} as any,
    new CustomerStatementPdfService(),
    {} as any,
    {} as any,
    {} as any,
  );
  return { service, prisma };
}

const statement = (month: string, toMonth?: string) => {
  const { service } = buildService();
  return service.getMonthlyStatementData(VENDOR_ID, CUSTOMER_ID, month, toMonth);
};

describe('statement with Customer Financial Adjustment rows', () => {
  it('fixture sanity: live balance is the sum of the whole ledger', () => {
    expect(LIVE_BALANCE).toBe(1250);
  });

  describe('September (the month with adjustments, a write-off and a void pair)', () => {
    it('opening balance is August\'s closing; closing balance excludes October', async () => {
      const s = await statement('2026-09');
      expect(s.openingBalance).toBe(1300); // 1000 delivery + 300 installation
      expect(s.closingBalance).toBe(850); // live 1250 − October's 400
    });

    it('every adjustment row appears with its customer-facing wording and signed amount, in order', async () => {
      const s = await statement('2026-09');
      expect(s.otherRows.map((r) => [r.type, r.description, r.amount])).toEqual([
        ['Adjustment', 'Late payment penalty', 500],
        ['Payment', 'Payment received', -200],
        ['Adjustment', 'Loyalty discount', -100],
        ['Adjustment', 'Account adjustment', -150],
        ['Adjustment', 'Reversal: Late payment penalty', -500],
      ]);
    });

    it('running balance is correct after every row and the last one equals the closing balance', async () => {
      const s = await statement('2026-09');
      expect(s.otherRows.map((r) => r.runningBalance)).toEqual([1800, 1600, 1500, 1350, 850]);
      expect(s.otherRows[s.otherRows.length - 1].runningBalance).toBe(s.closingBalance);
    });

    it('opening + the sum of the period\'s rows = closing (the statement foots)', async () => {
      const s = await statement('2026-09');
      const periodTotal = s.otherRows.reduce((sum, r) => sum + r.amount, 0);
      expect(s.openingBalance + periodTotal).toBe(s.closingBalance);
    });

    it('adjustments are NOT delivery rows: they never inflate deliveries, bottles or the rate', async () => {
      const s = await statement('2026-09');
      expect(s.deliveryRows).toHaveLength(0);
      expect(s.totals.totalBtl).toBe(0);
      expect(s.totals.totalRecv).toBe(0);
    });

    it('the void is append-only: the penalty AND its reversal both show, and they net to zero', async () => {
      const s = await statement('2026-09');
      const penalty = s.otherRows.find((r) => r.description === 'Late payment penalty')!;
      const reversal = s.otherRows.find((r) => r.description === 'Reversal: Late payment penalty')!;
      expect(penalty).toBeDefined();
      expect(reversal).toBeDefined();
      expect(penalty.amount + reversal.amount).toBe(0);
    });

    it('a SUMMARIZED write-off reads as the neutral label — the amount is shown, the staff wording is not', async () => {
      const s = await statement('2026-09');
      const writeOff = s.otherRows.find((r) => r.amount === -150)!;
      expect(writeOff.description).toBe('Account adjustment');
    });
  });

  describe('month boundaries', () => {
    it('August: an adjustment posted in August closes August, and September\'s rows do not leak back', async () => {
      const s = await statement('2026-08');
      expect(s.openingBalance).toBe(0);
      expect(s.closingBalance).toBe(1300);
      expect(s.deliveryRows).toHaveLength(1);
      expect(s.otherRows.map((r) => [r.description, r.amount, r.runningBalance])).toEqual([
        ['Installation charge', 300, 1300],
      ]);
    });

    it('October: opens where September closed, and the void pair is invisible to it (already netted)', async () => {
      const s = await statement('2026-10');
      expect(s.openingBalance).toBe(850);
      expect(s.closingBalance).toBe(1250); // = the live balance
      expect(s.otherRows).toHaveLength(0);
    });

    it('CONTINUITY: each month\'s opening balance equals the previous month\'s closing balance', async () => {
      const aug = await statement('2026-08');
      const sep = await statement('2026-09');
      const oct = await statement('2026-10');
      expect(sep.openingBalance).toBe(aug.closingBalance);
      expect(oct.openingBalance).toBe(sep.closingBalance);
    });

    it('a multi-month statement (Aug–Sep) has one opening, one closing, and both months\' adjustments', async () => {
      const s = await statement('2026-08', '2026-09');
      expect(s.openingBalance).toBe(0);
      expect(s.closingBalance).toBe(850);
      expect(s.otherRows.map((r) => r.runningBalance)).toEqual([1300, 1800, 1600, 1500, 1350, 850]);
      expect(s.otherRows.map((r) => r.description)).toContain('Installation charge');
    });
  });

  describe('backdated adjustments land in the right month on any server timezone', () => {
    // Production runs UTC; the vendor's day starts at 19:00 UTC the day before. Statement
    // windows are cut at the SERVER's midnight. An entry backdated to the 1st must be inside
    // that month under BOTH readings — this is the regression guard for the midnight bug.
    const NOW = new Date('2026-09-20T09:00:00.000Z');
    const entry = resolveAdjustmentEffectiveDate('2026-09-01', NOW);

    it('is inside September for a UTC server (windows cut at 00:00 UTC)', () => {
      expect(entry >= new Date('2026-09-01T00:00:00.000Z')).toBe(true);
      expect(entry < new Date('2026-10-01T00:00:00.000Z')).toBe(true);
    });

    it('is inside September for the vendor\'s own day (windows cut at 00:00 PKT = 19:00 UTC the day before)', () => {
      expect(entry >= new Date('2026-08-31T19:00:00.000Z')).toBe(true);
      expect(entry < new Date('2026-09-30T19:00:00.000Z')).toBe(true);
    });

    it('PKT MIDNIGHT would have failed the UTC reading — it fell in AUGUST', () => {
      const pktMidnight = new Date('2026-08-31T19:00:00.000Z');
      expect(pktMidnight < new Date('2026-09-01T00:00:00.000Z')).toBe(true); // i.e. last month on UTC
      expect(entry.getTime()).toBeGreaterThan(pktMidnight.getTime());
    });
  });
});
