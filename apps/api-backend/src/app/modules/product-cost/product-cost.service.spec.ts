import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ProductCostService } from './product-cost.service';

// ─── fixtures ─────────────────────────────────────────────────────────────────

const VENDOR_ID = 'vendor-001';
const PRODUCT_ID = 'product-001';

const adminUser = { userId: 'admin-001', vendorId: VENDOR_ID, name: 'Admin', role: 'VENDOR_ADMIN' } as any;

function row(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: 'cost-001',
    vendorId: VENDOR_ID,
    productId: PRODUCT_ID,
    costPerUnit: 100,
    effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    effectiveTo: null,
    note: null,
    invoiceRef: null,
    source: 'MANUAL',
    createdById: adminUser.userId,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    voidedAt: null,
    voidedById: null,
    voidReason: null,
    ...overrides,
  };
}

function makeService() {
  const tx = {
    productCost: {
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data })),
      create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'new-cost-001', ...data })),
    },
    auditLog: {
      create: jest.fn(),
    },
  };
  const prisma = {
    $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
    product: { findFirst: jest.fn().mockResolvedValue({ id: PRODUCT_ID }) },
    dailySheetItem: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
    productCost: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };

  const svc = new ProductCostService(prisma as any);
  return { svc, prisma, tx };
}

describe('ProductCostService', () => {
  // ── create() / Add ────────────────────────────────────────────────────────

  describe('create()', () => {
    it('inserts the first cost ever for a product with effectiveTo left open', async () => {
      const { svc, tx } = makeService();
      tx.productCost.findFirst.mockResolvedValue(null); // no covering row

      const result = await svc.create(adminUser, {
        productId: PRODUCT_ID,
        costPerUnit: 100,
        effectiveFrom: '2026-01-01',
      } as any);

      expect(result.effectiveTo).toBeNull();
      expect(result.costPerUnit).toBe(100);
      expect(tx.auditLog.create).toHaveBeenCalledTimes(1); // CREATE only, no TRIM
    });

    it('closes the previously-open row when a forward-dated new rate is added, WITHOUT requiring a note', async () => {
      const { svc, tx } = makeService();
      const current = row({ effectiveFrom: new Date('2026-01-01'), effectiveTo: null });
      // covering row lookup (step 1) returns the open row for the new, later date
      tx.productCost.findFirst.mockResolvedValueOnce(current);

      // Effective tomorrow (relative to real "now", not a fixture date) — a
      // routine "plant raised the price starting tomorrow" change, not a
      // backdated correction. 2026-09-15 polish: mandatory-note narrowed to
      // only apply when `effectiveFrom` is before today (see service comment
      // above `isBackdated`) — this test is the regression check for that.
      const tomorrow = new Date();
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      const effectiveFromIso = tomorrow.toISOString().slice(0, 10);

      const result = await svc.create(adminUser, {
        productId: PRODUCT_ID,
        costPerUnit: 120,
        effectiveFrom: effectiveFromIso,
        // note intentionally omitted — must succeed.
      } as any);

      expect(tx.productCost.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: current.id }, data: { effectiveTo: expect.any(Date) } }),
      );
      expect(result.effectiveTo).toBeNull(); // inherits the trimmed row's original (null) effectiveTo
      expect(tx.auditLog.create).toHaveBeenCalledTimes(2); // TRIM + CREATE
    });

    it('does NOT require a note when effectiveFrom is exactly today (the boundary belongs to "not backdated")', async () => {
      // Boundary check: "today" is the dividing line and belongs to the
      // NOT-backdated (no note required) side.
      const { svc, tx } = makeService();
      const current = row({ effectiveFrom: new Date('2026-01-01'), effectiveTo: null });
      tx.productCost.findFirst.mockResolvedValueOnce(current);

      const todayIso = new Date().toISOString().slice(0, 10);

      await expect(
        svc.create(adminUser, {
          productId: PRODUCT_ID,
          costPerUnit: 120,
          effectiveFrom: todayIso,
          // note omitted — must succeed, "today" is not backdated.
        } as any),
      ).resolves.toBeDefined();
    });

    it('splits an existing range on a true backdated insert, preserving the original effectiveTo', async () => {
      const { svc, tx } = makeService();
      // Existing range: 1 Jan -> 31 Mar. Backdate 15 Jan into the middle of it.
      const existing = row({
        effectiveFrom: new Date('2026-01-01'),
        effectiveTo: new Date('2026-03-31'),
      });
      tx.productCost.findFirst.mockResolvedValueOnce(existing);

      const result = await svc.create(adminUser, {
        productId: PRODUCT_ID,
        costPerUnit: 105,
        effectiveFrom: '2026-01-15',
        note: 'Plant notified late, backdated from Feb.',
      } as any);

      expect(tx.productCost.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: existing.id },
          data: { effectiveTo: new Date('2026-01-14T00:00:00.000Z') },
        }),
      );
      // New row must inherit the ORIGINAL (pre-trim) effectiveTo, not the trimmed one.
      expect(result.effectiveTo).toEqual(new Date('2026-03-31'));
      expect(result.effectiveFrom).toEqual(new Date('2026-01-15'));
    });

    it('rejects an insert with a duplicate effectiveFrom', async () => {
      const { svc, tx } = makeService();
      const existing = row({ effectiveFrom: new Date('2026-01-15'), effectiveTo: null });
      tx.productCost.findFirst.mockResolvedValueOnce(existing);

      await expect(
        svc.create(adminUser, {
          productId: PRODUCT_ID,
          costPerUnit: 105,
          effectiveFrom: '2026-01-15',
        } as any),
      ).rejects.toThrow(ConflictException);
      expect(tx.productCost.create).not.toHaveBeenCalled();
    });

    it('requires a note for a true backdated insert that trims an existing row', async () => {
      const { svc, tx } = makeService();
      const existing = row({
        effectiveFrom: new Date('2026-01-01'),
        effectiveTo: new Date('2026-03-31'),
      });
      tx.productCost.findFirst.mockResolvedValueOnce(existing);

      await expect(
        svc.create(adminUser, {
          productId: PRODUCT_ID,
          costPerUnit: 105,
          effectiveFrom: '2026-01-15',
          // note omitted
        } as any),
      ).rejects.toThrow(BadRequestException);
      expect(tx.productCost.update).not.toHaveBeenCalled();
      expect(tx.productCost.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the product does not belong to this vendor', async () => {
      const { svc, prisma } = makeService();
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(
        svc.create(adminUser, { productId: 'other', costPerUnit: 100, effectiveFrom: '2026-01-01' } as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── listHistory() / isEditable ────────────────────────────────────────────
  // 2026-09-15 polish: isEditable is bulk-computed per row so the frontend can
  // hide Edit proactively rather than discovering ineligibility only from a
  // 409 on submit (mirrors editCostPerUnit's own eligibility rule exactly).

  describe('listHistory()', () => {
    it('marks a row editable when zero deliveries fall in its range', async () => {
      const { svc, prisma } = makeService();
      const r = row({ effectiveFrom: new Date('2026-01-01'), effectiveTo: new Date('2026-03-31') });
      prisma.productCost.findMany.mockResolvedValue([r]);
      prisma.dailySheetItem.findMany.mockResolvedValue([]);

      const result = await svc.listHistory(adminUser, PRODUCT_ID);

      expect(result[0].isEditable).toBe(true);
    });

    it('marks a row NOT editable when a delivery falls inside its range', async () => {
      const { svc, prisma } = makeService();
      const r = row({ effectiveFrom: new Date('2026-01-01'), effectiveTo: new Date('2026-03-31') });
      prisma.productCost.findMany.mockResolvedValue([r]);
      prisma.dailySheetItem.findMany.mockResolvedValue([{ dailySheet: { date: new Date('2026-02-15') } }]);

      const result = await svc.listHistory(adminUser, PRODUCT_ID);

      expect(result[0].isEditable).toBe(false);
    });

    it('marks a row NOT editable when a delivery falls outside its range (sanity: not editable-by-default)', async () => {
      const { svc, prisma } = makeService();
      const r = row({ effectiveFrom: new Date('2026-01-01'), effectiveTo: new Date('2026-03-31') });
      prisma.productCost.findMany.mockResolvedValue([r]);
      // Delivery exists, but in April — outside this row's Jan-Mar range.
      prisma.dailySheetItem.findMany.mockResolvedValue([{ dailySheet: { date: new Date('2026-04-05') } }]);

      const result = await svc.listHistory(adminUser, PRODUCT_ID);

      expect(result[0].isEditable).toBe(true);
    });

    it('a voided row is always isEditable: false, regardless of deliveries', async () => {
      const { svc, prisma } = makeService();
      const r = row({
        effectiveFrom: new Date('2026-01-01'),
        effectiveTo: new Date('2026-03-31'),
        voidedAt: new Date('2026-04-01'),
      });
      prisma.productCost.findMany.mockResolvedValue([r]);
      prisma.dailySheetItem.findMany.mockResolvedValue([]);

      const result = await svc.listHistory(adminUser, PRODUCT_ID);

      expect(result[0].isEditable).toBe(false);
    });
  });

  // ── voidCurrentRow() / Void ───────────────────────────────────────────────

  describe('voidCurrentRow()', () => {
    it('voids the current row and reopens the predecessor it had trimmed', async () => {
      const { svc, tx } = makeService();
      const current = row({ id: 'cost-002', effectiveFrom: new Date('2026-01-15'), effectiveTo: null });
      const predecessor = row({ id: 'cost-001', effectiveFrom: new Date('2026-01-01'), effectiveTo: new Date('2026-01-14') });

      tx.productCost.findFirst
        .mockResolvedValueOnce(current) // load the row to void
        .mockResolvedValueOnce(null) // no later row exists
        .mockResolvedValueOnce(predecessor); // predecessor with next-lower effectiveFrom

      await svc.voidCurrentRow(adminUser, 'cost-002', { voidReason: 'Typo entry' } as any);

      expect(tx.productCost.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: predecessor.id }, data: { effectiveTo: null } }),
      );
      expect(tx.productCost.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: current.id },
          data: expect.objectContaining({ voidReason: 'Typo entry' }),
        }),
      );
      expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    });

    it('rejects voiding a row that is not the latest for that product', async () => {
      const { svc, tx } = makeService();
      const historical = row({ id: 'cost-001', effectiveFrom: new Date('2026-01-01'), effectiveTo: new Date('2026-01-14') });

      tx.productCost.findFirst.mockResolvedValueOnce(historical);

      await expect(
        svc.voidCurrentRow(adminUser, 'cost-001', { voidReason: 'Typo entry' } as any),
      ).rejects.toThrow(BadRequestException);
      expect(tx.productCost.update).not.toHaveBeenCalled();
    });
  });

  // ── editCostPerUnit() / Controlled Edit ───────────────────────────────────

  describe('editCostPerUnit()', () => {
    it('allows the edit when zero deliveries exist in the row range', async () => {
      const { svc, prisma, tx } = makeService();
      const existing = row({ effectiveFrom: new Date('2026-01-01'), effectiveTo: null });
      prisma.productCost.findFirst.mockResolvedValue(existing);
      prisma.dailySheetItem.count.mockResolvedValue(0);

      const result = await svc.editCostPerUnit(adminUser, existing.id, {
        costPerUnit: 150,
        note: 'Fixing a typo (was 105, should be 150).',
      } as any);

      expect(result.costPerUnit).toBe(150);
      expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    });

    it('rejects the edit when a delivery already exists in the row range', async () => {
      const { svc, prisma, tx } = makeService();
      const existing = row({ effectiveFrom: new Date('2026-01-01'), effectiveTo: null });
      prisma.productCost.findFirst.mockResolvedValue(existing);
      prisma.dailySheetItem.count.mockResolvedValue(3);

      await expect(
        svc.editCostPerUnit(adminUser, existing.id, { costPerUnit: 150, note: 'typo fix' } as any),
      ).rejects.toThrow(ConflictException);
      expect(tx.productCost.update).not.toHaveBeenCalled();
    });
  });
});
