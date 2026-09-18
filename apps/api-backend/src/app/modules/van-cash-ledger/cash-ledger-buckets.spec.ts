import { LedgerEntryStatus, SettlementMethod, StaffLedgerCategory } from '@prisma/client';
import { BUCKET_RANK, CASH_IN_BUCKETS, classifyStaffLedgerEntry, EXPENSE_BUCKETS, isCashSettlement, TRANSFER_BUCKETS } from './cash-ledger-buckets';

describe('classifyStaffLedgerEntry() — R6', () => {
  const posted = LedgerEntryStatus.POSTED;

  it('classifies a POSTED ADVANCE debit as payroll cash', () => {
    expect(classifyStaffLedgerEntry({ category: StaffLedgerCategory.ADVANCE, status: posted, amount: -5000 })).toBe(
      'PAYROLL_CASH',
    );
  });

  it('excludes a PENDING or VOIDED ADVANCE (no cash moved)', () => {
    expect(
      classifyStaffLedgerEntry({ category: StaffLedgerCategory.ADVANCE, status: LedgerEntryStatus.PENDING, amount: -5000 }),
    ).toBeNull();
    expect(
      classifyStaffLedgerEntry({ category: StaffLedgerCategory.ADVANCE, status: LedgerEntryStatus.VOIDED, amount: -5000 }),
    ).toBeNull();
  });

  it('excludes a positive (or zero) ADVANCE — an anomaly, an advance is always a debit', () => {
    expect(classifyStaffLedgerEntry({ category: StaffLedgerCategory.ADVANCE, status: posted, amount: 5000 })).toBeNull();
    expect(classifyStaffLedgerEntry({ category: StaffLedgerCategory.ADVANCE, status: posted, amount: 0 })).toBeNull();
  });

  it.each(
    Object.values(StaffLedgerCategory).filter((c) => c !== StaffLedgerCategory.ADVANCE),
  )('excludes every non-ADVANCE category (%s), debit or credit', (category) => {
    expect(classifyStaffLedgerEntry({ category, status: posted, amount: -1000 })).toBeNull();
    expect(classifyStaffLedgerEntry({ category, status: posted, amount: 1000 })).toBeNull();
  });
});

describe('isCashSettlement() — R6', () => {
  it('only CASH moved physical cash', () => {
    expect(isCashSettlement(SettlementMethod.CASH)).toBe(true);
    expect(isCashSettlement(SettlementMethod.BANK_TRANSFER)).toBe(false);
    expect(isCashSettlement(SettlementMethod.CHEQUE)).toBe(false);
  });
});

describe('BUCKET_RANK', () => {
  it('ranks every cash-in bucket before every cash-out bucket', () => {
    const maxIn = Math.max(...CASH_IN_BUCKETS.map((b) => BUCKET_RANK[b]));
    const minOut = Math.min(...[...EXPENSE_BUCKETS, ...TRANSFER_BUCKETS].map((b) => BUCKET_RANK[b]));
    expect(maxIn).toBeLessThan(minOut);
  });

  it('gives every bucket a distinct rank', () => {
    const ranks = Object.values(BUCKET_RANK);
    expect(new Set(ranks).size).toBe(ranks.length);
    expect(ranks).toHaveLength(7);
  });
});
