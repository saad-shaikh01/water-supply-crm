import { ExpenseService } from './expense.service';

/**
 * ExpenseService — accounting-period write guard wiring (Cash Ledger P2).
 *
 * Only OFFICE-CASH expenses (paidFromCash && no dailySheetId) are ledger
 * movements. create/update/remove must call `assertWritable` BEFORE mutating
 * with every business date touched (edit => old AND new date), and a rejecting
 * guard must abort the write.
 */
describe('ExpenseService — period guard', () => {
  let service: ExpenseService;
  let prisma: any;
  let guard: { assertWritable: jest.Mock };

  const VENDOR_ID = 'vendor-001';
  const ID = 'expense-001';
  const ACTOR = { userId: 'u1', userName: 'User' };
  const OLD_DATE = new Date('2026-08-10T00:00:00.000Z');

  function row(overrides: Record<string, unknown> = {}) {
    return {
      id: ID,
      vendorId: VENDOR_ID,
      createdById: 'creator',
      category: 'OTHER',
      amount: 100,
      paidFromCash: true,
      description: 'tea',
      date: OLD_DATE,
      vanId: null,
      dailySheetId: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    prisma = {
      expense: {
        findFirst: jest.fn().mockResolvedValue(row()),
        create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'new', ...data })),
        update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...row(), ...data })),
        delete: jest.fn().mockResolvedValue({}),
      },
      van: { findFirst: jest.fn().mockResolvedValue({ id: 'van-1' }) },
      dailySheet: { findFirst: jest.fn().mockResolvedValue({ isClosed: false }) },
      dailySheetLoad: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    guard = { assertWritable: jest.fn().mockResolvedValue(undefined) };
    service = new ExpenseService(
      prisma,
      { log: jest.fn().mockResolvedValue(undefined) } as any,
      {} as any,
      {} as any,
      guard as any,
    );
  });

  // ── create ───────────────────────────────────────────────────────────────
  describe('create', () => {
    const dto = { category: 'OTHER', amount: 50, description: 'x', date: '2026-08-12T00:00:00.000Z' } as any;

    it('office-cash expense → guard called once with the row date, before the insert', async () => {
      await service.create(VENDOR_ID, 'u1', dto);
      expect(guard.assertWritable).toHaveBeenCalledTimes(1);
      expect(guard.assertWritable).toHaveBeenCalledWith(VENDOR_ID, [new Date(dto.date)]);
      expect(guard.assertWritable.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.expense.create.mock.invocationCallOrder[0],
      );
    });

    it('card-paid expense → guard NOT called', async () => {
      await service.create(VENDOR_ID, 'u1', { ...dto, paidFromCash: false });
      expect(guard.assertWritable).not.toHaveBeenCalled();
      expect(prisma.expense.create).toHaveBeenCalled();
    });

    it('sheet-linked expense → guard NOT called', async () => {
      await service.create(VENDOR_ID, 'u1', { ...dto, dailySheetId: 'sheet-1' });
      expect(guard.assertWritable).not.toHaveBeenCalled();
      expect(prisma.expense.create).toHaveBeenCalled();
    });

    it('rejecting guard aborts the insert', async () => {
      guard.assertWritable.mockRejectedValue(new Error('period closed'));
      await expect(service.create(VENDOR_ID, 'u1', dto)).rejects.toThrow('period closed');
      expect(prisma.expense.create).not.toHaveBeenCalled();
    });
  });

  // ── update ───────────────────────────────────────────────────────────────
  describe('update', () => {
    it('date edit on an office-cash expense → guard gets BOTH old and new date', async () => {
      const newDate = '2026-09-02T00:00:00.000Z';
      await service.update(VENDOR_ID, ID, { date: newDate } as any, ACTOR);
      expect(guard.assertWritable).toHaveBeenCalledTimes(1);
      expect(guard.assertWritable).toHaveBeenCalledWith(VENDOR_ID, [OLD_DATE, new Date(newDate)]);
      expect(guard.assertWritable.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.expense.update.mock.invocationCallOrder[0],
      );
    });

    it('non-date edit on an office-cash expense → guard called with the (same) old date twice', async () => {
      await service.update(VENDOR_ID, ID, { amount: 200 } as any, ACTOR);
      expect(guard.assertWritable).toHaveBeenCalledWith(VENDOR_ID, [OLD_DATE, OLD_DATE]);
    });

    it('card-paid expense staying card-paid → guard NOT called', async () => {
      prisma.expense.findFirst.mockResolvedValue(row({ paidFromCash: false }));
      await service.update(VENDOR_ID, ID, { amount: 200 } as any, ACTOR);
      expect(guard.assertWritable).not.toHaveBeenCalled();
      expect(prisma.expense.update).toHaveBeenCalled();
    });

    it('open-sheet-linked expense staying sheet-linked → guard NOT called', async () => {
      prisma.expense.findFirst.mockResolvedValue(row({ dailySheetId: 'sheet-1' }));
      await service.update(VENDOR_ID, ID, { amount: 200 } as any, ACTOR);
      expect(guard.assertWritable).not.toHaveBeenCalled();
    });

    it('card-paid expense flipped to cash (resulting row qualifies) → guard called with both dates', async () => {
      prisma.expense.findFirst.mockResolvedValue(row({ paidFromCash: false }));
      await service.update(VENDOR_ID, ID, { paidFromCash: true, date: '2026-09-02T00:00:00.000Z' } as any, ACTOR);
      expect(guard.assertWritable).toHaveBeenCalledWith(VENDOR_ID, [OLD_DATE, new Date('2026-09-02T00:00:00.000Z')]);
    });

    it('office-cash expense flipped to card (existing row qualifies) → guard called', async () => {
      await service.update(VENDOR_ID, ID, { paidFromCash: false } as any, ACTOR);
      expect(guard.assertWritable).toHaveBeenCalledTimes(1);
    });

    it('sheet-linked expense unlinked from its sheet (resulting row qualifies) → guard called', async () => {
      prisma.expense.findFirst.mockResolvedValue(row({ dailySheetId: 'sheet-1' }));
      await service.update(VENDOR_ID, ID, { dailySheetId: '' } as any, ACTOR);
      expect(guard.assertWritable).toHaveBeenCalledTimes(1);
    });

    it('office-cash expense linked to a sheet (existing row qualifies) → guard called', async () => {
      await service.update(VENDOR_ID, ID, { dailySheetId: 'sheet-1' } as any, ACTOR);
      expect(guard.assertWritable).toHaveBeenCalledTimes(1);
    });

    it('rejecting guard aborts the update', async () => {
      guard.assertWritable.mockRejectedValue(new Error('period closed'));
      await expect(service.update(VENDOR_ID, ID, { amount: 1 } as any, ACTOR)).rejects.toThrow('period closed');
      expect(prisma.expense.update).not.toHaveBeenCalled();
    });
  });

  // ── remove ───────────────────────────────────────────────────────────────
  describe('remove', () => {
    it('office-cash expense → guard called once with the row date, before the delete', async () => {
      await service.remove(VENDOR_ID, ID, ACTOR);
      expect(guard.assertWritable).toHaveBeenCalledTimes(1);
      expect(guard.assertWritable).toHaveBeenCalledWith(VENDOR_ID, [OLD_DATE]);
      expect(guard.assertWritable.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.expense.delete.mock.invocationCallOrder[0],
      );
    });

    it('card-paid expense → guard NOT called', async () => {
      prisma.expense.findFirst.mockResolvedValue(row({ paidFromCash: false }));
      await service.remove(VENDOR_ID, ID, ACTOR);
      expect(guard.assertWritable).not.toHaveBeenCalled();
      expect(prisma.expense.delete).toHaveBeenCalled();
    });

    it('sheet-linked expense → guard NOT called', async () => {
      prisma.expense.findFirst.mockResolvedValue(row({ dailySheetId: 'sheet-1' }));
      await service.remove(VENDOR_ID, ID, ACTOR);
      expect(guard.assertWritable).not.toHaveBeenCalled();
      expect(prisma.expense.delete).toHaveBeenCalled();
    });

    it('rejecting guard aborts the delete', async () => {
      guard.assertWritable.mockRejectedValue(new Error('period closed'));
      await expect(service.remove(VENDOR_ID, ID, ACTOR)).rejects.toThrow('period closed');
      expect(prisma.expense.delete).not.toHaveBeenCalled();
    });
  });
});
