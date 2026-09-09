import { ConflictException, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '@water-supply-crm/types';
import { ExpenseService } from './expense.service';

/**
 * Unit tests: ExpenseService — Post-Close Expense Correction (edit / void / add
 * an Expense row on an ALREADY-CLOSED daily sheet).
 *
 * Mirrors the daily-sheet siblings correctClosedTrip / voidDelivery: each of the
 * three methods 404s / 409s on the shared guards, row-locks the Expense inside a
 * `$transaction`, re-asserts the sheet is still closed, mutates only the row +
 * bumps `DailySheet.postCloseExpenseCorrectionCount`, then post-commit writes a
 * `CLOSED_EXPENSE_*` audit row carrying the mandatory `correctionNote` and fans
 * out the 3-way cache invalidation. It never rewrites `cashExpected` /
 * `cashCollected`.
 */
describe('ExpenseService — post-close expense correction', () => {
  let service: ExpenseService;
  let mockPrisma: any;
  let mockAudit: any;
  let mockCache: any;
  let mockVanCashLedger: any;
  let tx: any;

  const VENDOR_ID = 'vendor-001';
  const EXPENSE_ID = 'expense-001';
  const SHEET_ID = 'sheet-001';
  const SHEET_DATE = new Date('2026-08-17T00:00:00.000Z');

  const USER: AuthUser = {
    userId: 'admin-1',
    email: 'a@example.com',
    name: 'Admin',
    role: 'VENDOR_ADMIN' as AuthUser['role'],
    vendorId: VENDOR_ID,
    customerId: null,
  };

  function buildExpense(overrides: Record<string, unknown> = {}) {
    return {
      id: EXPENSE_ID,
      vendorId: VENDOR_ID,
      createdById: 'creator-1',
      category: 'OTHER',
      amount: 500,
      paidFromCash: true,
      description: 'tea',
      date: SHEET_DATE,
      vanId: null,
      dailySheetId: SHEET_ID,
      dailySheetLoadId: null,
      createdAt: SHEET_DATE,
      dailySheet: { id: SHEET_ID, isClosed: true, date: SHEET_DATE },
      fuelLog: null,
      vehicleServiceRecord: null,
      discrepancyCase: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      expense: {
        findUnique: jest.fn().mockResolvedValue({
          id: EXPENSE_ID,
          dailySheetId: SHEET_ID,
          dailySheet: { isClosed: true },
        }),
        update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: EXPENSE_ID, ...data })),
        delete: jest.fn().mockResolvedValue({ id: EXPENSE_ID }),
        create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'expense-new', ...data })),
      },
      dailySheet: {
        update: jest.fn().mockResolvedValue({}),
        // Read by ExpenseService.syncVanCashLedgerForClosedSheet (Van Cash
        // Ledger hook #2) via SHEET_CASH_RELOAD_INCLUDE — a minimal
        // resolveSheetCash-safe shape (isClosed + empty relation arrays).
        findUnique: jest.fn().mockResolvedValue({
          id: SHEET_ID,
          isClosed: true,
          cashCollected: 0,
          cashExpected: 0,
          items: [],
          expenses: [],
          crewCashDistributions: [],
          loads: [],
        }),
      },
    };
    mockPrisma = {
      expense: { findFirst: jest.fn().mockResolvedValue(buildExpense()) },
      van: { findFirst: jest.fn().mockResolvedValue({ id: 'van-1', vendorId: VENDOR_ID }) },
      dailySheet: { findFirst: jest.fn().mockResolvedValue({ id: SHEET_ID, isClosed: true, date: SHEET_DATE }) },
      dailySheetLoad: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)),
    };
    mockAudit = { log: jest.fn().mockResolvedValue(undefined) };
    mockCache = {
      invalidateDailyDashboard: jest.fn().mockResolvedValue(undefined),
      invalidateOverview: jest.fn().mockResolvedValue(undefined),
      invalidateAnalytics: jest.fn().mockResolvedValue(undefined),
    };
    mockVanCashLedger = { handlePostCloseCorrection: jest.fn().mockResolvedValue(null) };
    service = new ExpenseService(mockPrisma, mockAudit, mockCache, mockVanCashLedger);
  });

  afterEach(() => jest.clearAllMocks());

  // ── correctClosed ────────────────────────────────────────────────────────
  it('correctClosed → 409 when the sheet is not closed', async () => {
    mockPrisma.expense.findFirst.mockResolvedValue(
      buildExpense({ dailySheet: { id: SHEET_ID, isClosed: false, date: SHEET_DATE } }),
    );
    await expect(
      service.correctClosed(USER, EXPENSE_ID, { amount: 600, correctionNote: 'fix' } as any),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('correctClosed → 404 when the expense does not exist', async () => {
    mockPrisma.expense.findFirst.mockResolvedValue(null);
    await expect(
      service.correctClosed(USER, EXPENSE_ID, { amount: 600, correctionNote: 'fix' } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('correctClosed → 409 when the expense is linked to a Fuel Log', async () => {
    mockPrisma.expense.findFirst.mockResolvedValue(buildExpense({ fuelLog: { id: 'fuel-1' } }));
    await expect(
      service.correctClosed(USER, EXPENSE_ID, { amount: 600, correctionNote: 'fix' } as any),
    ).rejects.toThrow(/Fuel Log/i);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('correctClosed happy path → only sent fields updated, counter bumped, audited, cache fanned, no cashExpected write', async () => {
    await service.correctClosed(USER, EXPENSE_ID, {
      amount: 750,
      description: 'corrected tea',
      correctionNote: 'driver logged 500, actually 750',
    } as any);

    // row-lock ran first, before the in-txn re-read
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.expense.findUnique.mock.invocationCallOrder[0],
    );

    // only the provided fields
    const updateData = tx.expense.update.mock.calls[0][0].data;
    expect(updateData).toEqual({ amount: 750, description: 'corrected tea' });
    expect(updateData).not.toHaveProperty('category');

    // marker bumped, nothing else touched on the sheet
    expect(tx.dailySheet.update).toHaveBeenCalledWith({
      where: { id: SHEET_ID },
      data: { postCloseExpenseCorrectionCount: { increment: 1 } },
    });
    for (const call of tx.dailySheet.update.mock.calls) {
      expect(call[0].data).not.toHaveProperty('cashExpected');
      expect(call[0].data).not.toHaveProperty('cashCollected');
    }

    // Van Cash Ledger hook #2 — recomputed inside the same transaction
    expect(mockVanCashLedger.handlePostCloseCorrection).toHaveBeenCalledWith(tx, VENDOR_ID, SHEET_ID, 0);

    // audit
    const audit = mockAudit.log.mock.calls[0][0];
    expect(audit.action).toBe('CLOSED_EXPENSE_CORRECTED');
    expect(audit.entity).toBe('Expense');
    expect(audit.changes.after.correctionNote).toBe('driver logged 500, actually 750');
    expect(audit.changes.before.amount).toBe(500);

    // 3-way cache
    expect(mockCache.invalidateDailyDashboard).toHaveBeenCalledWith(VENDOR_ID, '2026-08-17');
    expect(mockCache.invalidateOverview).toHaveBeenCalledWith(VENDOR_ID);
    expect(mockCache.invalidateAnalytics).toHaveBeenCalledWith(VENDOR_ID);
  });

  // ── voidClosed ───────────────────────────────────────────────────────────
  it('voidClosed → hard-deletes the row, bumps the counter, audits the full before block', async () => {
    const res = await service.voidClosed(USER, EXPENSE_ID, { correctionNote: 'duplicate entry' } as any);

    expect(tx.expense.delete).toHaveBeenCalledWith({ where: { id: EXPENSE_ID } });
    expect(tx.dailySheet.update).toHaveBeenCalledWith({
      where: { id: SHEET_ID },
      data: { postCloseExpenseCorrectionCount: { increment: 1 } },
    });

    expect(mockVanCashLedger.handlePostCloseCorrection).toHaveBeenCalledWith(tx, VENDOR_ID, SHEET_ID, 0);

    const audit = mockAudit.log.mock.calls[0][0];
    expect(audit.action).toBe('CLOSED_EXPENSE_VOIDED');
    expect(audit.changes.before.amount).toBe(500);
    expect(audit.changes.before.correctionNote).toBe('duplicate entry');
    expect(audit.changes.after).toBeUndefined();
    expect(res).toEqual({ deleted: true });
  });

  it('voidClosed → 409 when the expense is linked to a discrepancy case', async () => {
    mockPrisma.expense.findFirst.mockResolvedValue(buildExpense({ discrepancyCase: { id: 'disc-1' } }));
    await expect(
      service.voidClosed(USER, EXPENSE_ID, { correctionNote: 'nope' } as any),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  // ── createClosed ─────────────────────────────────────────────────────────
  it('createClosed → 409 when the target sheet is not closed', async () => {
    mockPrisma.dailySheet.findFirst.mockResolvedValue({ id: SHEET_ID, isClosed: false, date: SHEET_DATE });
    await expect(
      service.createClosed(USER, {
        category: 'OTHER',
        amount: 300,
        description: 'late entry',
        date: '2026-08-17',
        dailySheetId: SHEET_ID,
        correctionNote: 'forgot to log it',
      } as any),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('createClosed happy path → row created, counter bumped, audited CLOSED_EXPENSE_ADDED', async () => {
    const created = await service.createClosed(USER, {
      category: 'OTHER',
      amount: 300,
      description: 'late entry',
      date: '2026-08-17',
      dailySheetId: SHEET_ID,
      correctionNote: 'forgot to log it',
    } as any);

    expect(tx.expense.create).toHaveBeenCalledTimes(1);
    expect(tx.expense.create.mock.calls[0][0].data.dailySheetId).toBe(SHEET_ID);
    expect(tx.dailySheet.update).toHaveBeenCalledWith({
      where: { id: SHEET_ID },
      data: { postCloseExpenseCorrectionCount: { increment: 1 } },
    });
    expect(mockVanCashLedger.handlePostCloseCorrection).toHaveBeenCalledWith(tx, VENDOR_ID, SHEET_ID, 0);
    const audit = mockAudit.log.mock.calls[0][0];
    expect(audit.action).toBe('CLOSED_EXPENSE_ADDED');
    expect(audit.changes.after.correctionNote).toBe('forgot to log it');
    expect(created.id).toBe('expense-new');
    expect(mockCache.invalidateAnalytics).toHaveBeenCalledWith(VENDOR_ID);
  });

  // ── plain update()/remove() closed-sheet guard (the latent hole) ──────────
  it('update() → 409 for a closed-sheet expense (must go through /correct)', async () => {
    mockPrisma.expense.findFirst.mockResolvedValue({ id: EXPENSE_ID, dailySheetId: SHEET_ID });
    mockPrisma.dailySheet.findFirst.mockResolvedValue({ isClosed: true });
    await expect(service.update(VENDOR_ID, EXPENSE_ID, { amount: 999 } as any)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('remove() → 409 for a closed-sheet expense (must go through /void)', async () => {
    mockPrisma.expense.findFirst.mockResolvedValue({ id: EXPENSE_ID, dailySheetId: SHEET_ID });
    mockPrisma.dailySheet.findFirst.mockResolvedValue({ isClosed: true });
    await expect(service.remove(VENDOR_ID, EXPENSE_ID)).rejects.toBeInstanceOf(ConflictException);
  });
});
