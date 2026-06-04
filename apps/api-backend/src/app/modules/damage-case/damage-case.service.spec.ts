import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { DamageCaseService } from './damage-case.service';
import { DamageCaseStatus, DamageSeverity, WriteOffCategory } from '@prisma/client';

// ─── fixtures ─────────────────────────────────────────────────────────────────

const VENDOR_ID   = 'vendor-001';
const CUSTOMER_ID = 'customer-001';
const PRODUCT_ID  = 'product-001';
const DRIVER_ID   = 'driver-001';
const CASE_ID     = 'case-001';
const TX_ID       = 'tx-001';

const driverUser  = { userId: DRIVER_ID,   vendorId: VENDOR_ID, role: 'DRIVER'       } as any;
const adminUser   = { userId: 'admin-001', vendorId: VENDOR_ID, role: 'VENDOR_ADMIN'  } as any;

const baseCase = {
  id: CASE_ID, vendorId: VENDOR_ID, customerId: CUSTOMER_ID, productId: PRODUCT_ID,
  driverId: DRIVER_ID, bottleCount: 2, severity: DamageSeverity.MODERATE,
  photoKeys: ['damage-photos/photo-001.jpg'],
  status: DamageCaseStatus.REPORTED, version: 0, chargeAmount: null,
};

const underReviewCase = { ...baseCase, status: DamageCaseStatus.UNDER_REVIEW, version: 1 };
const chargedCase     = { ...baseCase, status: DamageCaseStatus.CHARGED, chargeAmount: 500, version: 2 };

const fullWallet  = { customerId: CUSTOMER_ID, productId: PRODUCT_ID, balance: 5 };
const emptyWallet = { ...fullWallet, balance: 1 }; // 1 < bottleCount (2)

// ─── mock tx factory ─────────────────────────────────────────────────────────

function makeTx(caseSnapshot: any = underReviewCase, walletSnapshot: any = fullWallet) {
  return {
    damageCase:          { findUnique: jest.fn().mockResolvedValue(caseSnapshot),
                           update:     jest.fn().mockImplementation(async ({ data }) => ({ ...caseSnapshot, ...data })) },
    bottleWallet:        { findUnique: jest.fn().mockResolvedValue(walletSnapshot),
                           update:     jest.fn().mockResolvedValue({ ...walletSnapshot }) },
    customer:            { update: jest.fn().mockResolvedValue({ id: CUSTOMER_ID }) },
    transaction:         { create: jest.fn().mockResolvedValue({ id: TX_ID }) },
    damageCaseAuditLog:  { create: jest.fn().mockResolvedValue({ id: 'audit-001' }) },
  };
}

// ─── service factory ─────────────────────────────────────────────────────────

function makeService(prismaOverrides: Partial<Record<string, any>> = {}) {
  const tx = makeTx();
  const prisma = {
    $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
    damageCase:         { create: jest.fn().mockResolvedValue(baseCase),
                          findUnique: jest.fn().mockResolvedValue(baseCase),
                          findFirst:  jest.fn().mockResolvedValue(null),
                          update:     jest.fn().mockResolvedValue(baseCase) },
    damageCaseAuditLog: { create: jest.fn().mockResolvedValue({}) },
    ...prismaOverrides,
  };

  const storage            = { upload: jest.fn(), getSignedUrl: jest.fn() };
  const inAppNotifications = { create: jest.fn().mockResolvedValue(undefined) };
  const fcm                = { sendToCustomer:   jest.fn().mockResolvedValue({ sent: 1, failed: 0 }),
                               sendToVendorUsers: jest.fn().mockResolvedValue(undefined) };

  const svc = new DamageCaseService(prisma as any, storage as any, inAppNotifications as any, fcm as any);
  return { svc, prisma, tx, storage, inAppNotifications, fcm };
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('DamageCaseService — bottle-damage integration tests', () => {

  // ── 1. CHARGE: financialBalance↑ AND wallet↓ atomically ─────────────────

  describe('charge()', () => {
    const chargeDto = { chargeAmount: 500, writeOffCategory: WriteOffCategory.CUSTOMER_NEGLIGENCE, version: 1 };

    it('runs inside a single $transaction', async () => {
      const { svc, prisma } = makeService();
      await svc.charge(adminUser, CASE_ID, chargeDto);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('decrements bottle wallet atomically inside the transaction', async () => {
      const { svc, tx } = makeService();
      await svc.charge(adminUser, CASE_ID, chargeDto);
      expect(tx.bottleWallet.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { balance: { decrement: underReviewCase.bottleCount } } }),
      );
    });

    it('increments financialBalance atomically inside the transaction', async () => {
      const { svc, tx } = makeService();
      await svc.charge(adminUser, CASE_ID, chargeDto);
      expect(tx.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { financialBalance: { increment: chargeDto.chargeAmount } } }),
      );
    });

    it('creates an ADJUSTMENT Transaction with correct positive amount', async () => {
      const { svc, tx } = makeService();
      await svc.charge(adminUser, CASE_ID, chargeDto);
      expect(tx.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ amount: chargeDto.chargeAmount }) }),
      );
    });

    it('writes a CHARGED audit log entry', async () => {
      const { svc, tx } = makeService();
      await svc.charge(adminUser, CASE_ID, chargeDto);
      expect(tx.damageCaseAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'CHARGED' }) }),
      );
    });
  });

  // ── 2. WAIVE: wallet↓ only, NO money ────────────────────────────────────

  describe('waive()', () => {
    const waiveDto = { writeOffCategory: WriteOffCategory.NORMAL_WEAR, version: 1 };

    it('decrements bottle wallet inside the transaction', async () => {
      const { svc, tx } = makeService();
      await svc.waive(adminUser, CASE_ID, waiveDto);
      expect(tx.bottleWallet.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { balance: { decrement: underReviewCase.bottleCount } } }),
      );
    });

    it('does NOT touch financialBalance', async () => {
      const { svc, tx } = makeService();
      await svc.waive(adminUser, CASE_ID, waiveDto);
      expect(tx.customer.update).not.toHaveBeenCalled();
    });

    it('does NOT create a Transaction row (no reconciliation job)', async () => {
      const { svc, tx } = makeService();
      await svc.waive(adminUser, CASE_ID, waiveDto);
      expect(tx.transaction.create).not.toHaveBeenCalled();
    });

    it('writes a WAIVED audit log entry', async () => {
      const { svc, tx } = makeService();
      await svc.waive(adminUser, CASE_ID, waiveDto);
      expect(tx.damageCaseAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'WAIVED' }) }),
      );
    });
  });

  // ── 3. REVERSE: money credit only, wallet untouched ──────────────────────

  describe('reverse()', () => {
    function makeChargedService() {
      const tx = makeTx(chargedCase);
      const prisma = {
        $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
        damageCase:         { findUnique: jest.fn(), update: jest.fn() },
        damageCaseAuditLog: { create: jest.fn() },
      };
      const svc = new DamageCaseService(
        prisma as any,
        { upload: jest.fn(), getSignedUrl: jest.fn() } as any,
        { create: jest.fn() } as any,
        { sendToCustomer: jest.fn().mockResolvedValue({}), sendToVendorUsers: jest.fn() } as any,
      );
      return { svc, prisma, tx };
    }

    it('decrements financialBalance by the stored chargeAmount', async () => {
      const { svc, tx } = makeChargedService();
      await svc.reverse(adminUser, CASE_ID, { version: chargedCase.version });
      expect(tx.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { financialBalance: { decrement: chargedCase.chargeAmount } } }),
      );
    });

    it('does NOT restore the bottle wallet', async () => {
      const { svc, tx } = makeChargedService();
      await svc.reverse(adminUser, CASE_ID, { version: chargedCase.version });
      expect(tx.bottleWallet.update).not.toHaveBeenCalled();
    });

    it('creates a negative-amount Transaction (credit record)', async () => {
      const { svc, tx } = makeChargedService();
      await svc.reverse(adminUser, CASE_ID, { version: chargedCase.version });
      expect(tx.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ amount: -(chargedCase.chargeAmount!) }) }),
      );
    });

    it('audit payload explicitly notes bottle wallet is NOT restored', async () => {
      const { svc, tx } = makeChargedService();
      await svc.reverse(adminUser, CASE_ID, { version: chargedCase.version });
      expect(tx.damageCaseAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'REVERSED',
            payload: expect.objectContaining({ note: expect.stringContaining('Bottle wallet NOT restored') }),
          }),
        }),
      );
    });
  });

  // ── 4. Negative wallet 400 guard ────────────────────────────────────────

  describe('negative-wallet guard', () => {
    const chargeDto = { chargeAmount: 500, writeOffCategory: WriteOffCategory.CUSTOMER_NEGLIGENCE, version: 1 };

    function makeServiceWithWallet(wallet: typeof fullWallet | null) {
      const tx = makeTx(underReviewCase, wallet as any);
      tx.bottleWallet.findUnique.mockResolvedValue(wallet);
      const prisma = {
        $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
        damageCase:         { findUnique: jest.fn(), update: jest.fn() },
        damageCaseAuditLog: { create: jest.fn() },
      };
      const svc = new DamageCaseService(prisma as any, {} as any, {} as any, { sendToCustomer: jest.fn().mockResolvedValue({}) } as any);
      return { svc, tx };
    }

    it('throws 400 when wallet balance < bottleCount', async () => {
      const { svc } = makeServiceWithWallet(emptyWallet);
      await expect(svc.charge(adminUser, CASE_ID, chargeDto)).rejects.toThrow(BadRequestException);
    });

    it('throws 400 when BottleWallet row does not exist', async () => {
      const { svc } = makeServiceWithWallet(null);
      await expect(svc.charge(adminUser, CASE_ID, chargeDto)).rejects.toThrow(BadRequestException);
    });

    it('throws 400 on waive when wallet balance < bottleCount', async () => {
      const { svc } = makeServiceWithWallet(emptyWallet);
      await expect(svc.waive(adminUser, CASE_ID, { writeOffCategory: WriteOffCategory.NORMAL_WEAR, version: 1 }))
        .rejects.toThrow(BadRequestException);
    });

    it('throws 400 when chargeAmount is zero', async () => {
      const { svc } = makeServiceWithWallet(fullWallet);
      await expect(svc.charge(adminUser, CASE_ID, { ...chargeDto, chargeAmount: 0 })).rejects.toThrow(BadRequestException);
    });

    it('throws 400 when no photos attached', async () => {
      const tx = makeTx({ ...underReviewCase, photoKeys: [] });
      const prisma = { $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)) };
      const svc = new DamageCaseService(prisma as any, {} as any, {} as any, { sendToCustomer: jest.fn().mockResolvedValue({}) } as any);
      await expect(svc.charge(adminUser, CASE_ID, chargeDto)).rejects.toThrow(BadRequestException);
    });
  });

  // ── 5. Optimistic-lock 409 ──────────────────────────────────────────────

  describe('optimistic lock — concurrent modification', () => {
    function makeStaleVersionService(caseAtVersion: number) {
      const tx = makeTx({ ...underReviewCase, version: caseAtVersion });
      const prisma = {
        $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
        damageCase:         { findUnique: jest.fn().mockResolvedValue({ ...baseCase, version: caseAtVersion }),
                              update: jest.fn() },
        damageCaseAuditLog: { create: jest.fn() },
      };
      const svc = new DamageCaseService(prisma as any, {} as any, {} as any, { sendToCustomer: jest.fn().mockResolvedValue({}) } as any);
      return { svc, prisma };
    }

    it('throws ConflictException when charge is sent with stale version', async () => {
      const { svc } = makeStaleVersionService(5);
      await expect(svc.charge(adminUser, CASE_ID, {
        chargeAmount: 500, writeOffCategory: WriteOffCategory.CUSTOMER_NEGLIGENCE, version: 1,
      })).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when waive is sent with stale version', async () => {
      const { svc } = makeStaleVersionService(5);
      await expect(svc.waive(adminUser, CASE_ID, {
        writeOffCategory: WriteOffCategory.NORMAL_WEAR, version: 1,
      })).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when reverse is sent with stale version', async () => {
      const tx = makeTx({ ...chargedCase, version: 5 });
      const prisma = { $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)) };
      const svc = new DamageCaseService(prisma as any, {} as any, {} as any, { sendToCustomer: jest.fn().mockResolvedValue({}) } as any);
      await expect(svc.reverse(adminUser, CASE_ID, { version: 2 })).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when update (bottleCount) is sent with stale version', async () => {
      const { svc, prisma } = makeStaleVersionService(4);
      prisma.damageCase.findUnique.mockResolvedValue({ ...baseCase, version: 4 });
      await expect(svc.update(driverUser, CASE_ID, { bottleCount: 3, version: 1 })).rejects.toThrow(ConflictException);
    });
  });

  // ── 6. Double-charge idempotency ─────────────────────────────────────────

  describe('double-charge idempotency', () => {
    const chargeDto = { chargeAmount: 500, writeOffCategory: WriteOffCategory.CUSTOMER_NEGLIGENCE, version: 2 };

    it('throws 400 when attempting to charge an already-CHARGED case', async () => {
      const tx = makeTx(chargedCase);
      const prisma = { $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)) };
      const svc = new DamageCaseService(prisma as any, {} as any, {} as any, { sendToCustomer: jest.fn().mockResolvedValue({}) } as any);
      await expect(svc.charge(adminUser, CASE_ID, chargeDto)).rejects.toThrow(BadRequestException);
    });

    it('throws 400 when attempting to charge a WAIVED case', async () => {
      const tx = makeTx({ ...underReviewCase, status: DamageCaseStatus.WAIVED });
      const prisma = { $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)) };
      const svc = new DamageCaseService(prisma as any, {} as any, {} as any, { sendToCustomer: jest.fn().mockResolvedValue({}) } as any);
      await expect(svc.charge(adminUser, CASE_ID, { ...chargeDto, version: 1 })).rejects.toThrow(BadRequestException);
    });

    it('throws 400 when attempting to reverse a WAIVED case', async () => {
      const tx = makeTx({ ...underReviewCase, status: DamageCaseStatus.WAIVED });
      const prisma = { $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)) };
      const svc = new DamageCaseService(prisma as any, {} as any, {} as any, { sendToCustomer: jest.fn().mockResolvedValue({}) } as any);
      await expect(svc.reverse(adminUser, CASE_ID, { version: 1 })).rejects.toThrow(BadRequestException);
    });
  });

  // ── 7. DRIVER ownership guard (update) ──────────────────────────────────

  describe('update() DRIVER ownership', () => {
    it('allows DRIVER to update their own REPORTED case', async () => {
      const { svc, prisma } = makeService();
      prisma.damageCase.findUnique.mockResolvedValue(baseCase);
      prisma.damageCase.update.mockResolvedValue({ ...baseCase, bottleCount: 3, version: 1 });
      const result = await svc.update(driverUser, CASE_ID, { bottleCount: 3, version: 0 });
      expect(result.bottleCount).toBe(3);
    });

    it('throws ForbiddenException when DRIVER edits another driver\'s case', async () => {
      const { svc, prisma } = makeService();
      prisma.damageCase.findUnique.mockResolvedValue({ ...baseCase, driverId: 'other-driver' });
      await expect(svc.update(driverUser, CASE_ID, { bottleCount: 3, version: 0 })).rejects.toThrow(ForbiddenException);
    });

    it('throws 400 when attempting to update a non-REPORTED case', async () => {
      const { svc, prisma } = makeService();
      prisma.damageCase.findUnique.mockResolvedValue(underReviewCase);
      await expect(svc.update(driverUser, CASE_ID, { bottleCount: 3, version: 1 })).rejects.toThrow(BadRequestException);
    });
  });
});
