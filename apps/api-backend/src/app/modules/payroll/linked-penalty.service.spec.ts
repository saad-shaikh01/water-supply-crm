import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LinkedPenaltyService } from './linked-penalty.service';

// ─── fixtures ─────────────────────────────────────────────────────────────────

const VENDOR_ID = 'vendor-001';
const EMPLOYEE_ID = 'employee-001';
const CUSTOMER_ID = 'customer-001';
const ENTRY_ID = 'entry-001';
const ADJUSTMENT_ID = 'adjustment-001';

const user = { userId: 'admin-001', vendorId: VENDOR_ID, role: 'VENDOR_ADMIN', name: 'Admin' } as any;

function makeCreateDto(overrides: Partial<any> = {}) {
  return {
    userId: EMPLOYEE_ID,
    category: 'PENALTY',
    amount: -300,
    effectiveDate: '2026-09-25',
    description: 'Driver never recorded a cash payment',
    customerId: CUSTOMER_ID,
    customerCreditTitle: 'Cash payment recorded late',
    ...overrides,
  };
}

function makeService(opts: { employeeExists?: boolean; customerExists?: boolean; startingBalance?: number } = {}) {
  const { employeeExists = true, customerExists = true, startingBalance = 700 } = opts;

  const tx = Symbol('tx');
  const prisma = {
    $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
    user: {
      findFirst: jest.fn().mockResolvedValue(employeeExists ? { id: EMPLOYEE_ID, name: 'Driver Khan' } : null),
    },
    customer: {
      findFirst: jest.fn().mockResolvedValue(customerExists ? { id: CUSTOMER_ID } : null),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ financialBalance: startingBalance }),
    },
    staffLedgerEntry: {
      findFirst: jest.fn(),
    },
  };

  const staffLedger = {
    createTx: jest.fn().mockImplementation(async (_tx: any, _u: any, dto: any) => ({
      id: ENTRY_ID,
      vendorId: VENDOR_ID,
      userId: dto.userId,
      category: dto.category,
      amount: dto.amount,
      linkedCustomerId: dto.linkedCustomerId,
      causedCustomerAdjustmentId: dto.causedCustomerAdjustmentId,
    })),
    voidEntryTx: jest.fn().mockImplementation(async () => ({
      id: ENTRY_ID,
      causedCustomerAdjustmentId: ADJUSTMENT_ID,
      status: 'VOIDED',
    })),
  };

  const customerAdjustment = {
    createTx: jest.fn().mockImplementation(async (_tx: any, _u: any, input: any) => ({
      adjustment: { id: ADJUSTMENT_ID, customerId: input.customerId, kind: input.kind, amount: input.amount },
      transaction: { id: 'txn-001', amount: -input.amount },
      customerBalance: startingBalance,
    })),
    voidAdjustmentTx: jest.fn().mockImplementation(async () => ({
      adjustment: { id: ADJUSTMENT_ID, customerId: CUSTOMER_ID, status: 'VOIDED' },
      reversal: { id: 'reversal-001' },
      reversalTransaction: { id: 'txn-002' },
      customerBalance: 1000,
    })),
  };

  const cache = {
    invalidateVendorEntity: jest.fn().mockResolvedValue(undefined),
    invalidateOverview: jest.fn().mockResolvedValue(undefined),
    invalidateAnalytics: jest.fn().mockResolvedValue(undefined),
    invalidateCustomerWallets: jest.fn().mockResolvedValue(undefined),
  };

  const svc = new LinkedPenaltyService(prisma as any, staffLedger as any, customerAdjustment as any, cache as any);
  return { svc, prisma, staffLedger, customerAdjustment, cache };
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('LinkedPenaltyService', () => {
  describe('createLinkedPenalty()', () => {
    it('happy path: 1000 -> 700 on the customer, -300 on the employee, cross-linked, in ONE transaction', async () => {
      const { svc, prisma, staffLedger, customerAdjustment } = makeService({ startingBalance: 700 });

      const result = await svc.createLinkedPenalty(user, makeCreateDto());

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);

      // Customer credited the ABSOLUTE value of the (negative) penalty amount.
      expect(customerAdjustment.createTx).toHaveBeenCalledWith(
        expect.anything(),
        user,
        expect.objectContaining({
          customerId: CUSTOMER_ID,
          kind: 'STAFF_FAULT_CREDIT',
          direction: 'CREDIT',
          amount: 300,
          title: 'Cash payment recorded late',
        }),
      );

      // Employee docked the exact signed amount, linked to the adjustment just created.
      expect(staffLedger.createTx).toHaveBeenCalledWith(
        expect.anything(),
        user,
        expect.objectContaining({
          userId: EMPLOYEE_ID,
          category: 'PENALTY',
          amount: -300,
          linkedCustomerId: CUSTOMER_ID,
          causedCustomerAdjustmentId: ADJUSTMENT_ID,
        }),
      );

      expect(result.customerBalance).toBe(700);
      expect(result.penaltyEntry.causedCustomerAdjustmentId).toBe(ADJUSTMENT_ID);
      expect(result.customerAdjustment.id).toBe(ADJUSTMENT_ID);
    });

    it('posts the customer credit BEFORE the staff debit, inside the same transaction call', async () => {
      const { svc, staffLedger, customerAdjustment } = makeService();
      await svc.createLinkedPenalty(user, makeCreateDto());

      const adjustmentOrder = customerAdjustment.createTx.mock.invocationCallOrder[0];
      const entryOrder = staffLedger.createTx.mock.invocationCallOrder[0];
      expect(adjustmentOrder).toBeLessThan(entryOrder);
    });

    it('rejects when the employee does not belong to this vendor', async () => {
      const { svc, staffLedger, customerAdjustment } = makeService({ employeeExists: false });

      await expect(svc.createLinkedPenalty(user, makeCreateDto())).rejects.toBeInstanceOf(NotFoundException);
      expect(staffLedger.createTx).not.toHaveBeenCalled();
      expect(customerAdjustment.createTx).not.toHaveBeenCalled();
    });

    it('rejects when the customer does not belong to this vendor', async () => {
      const { svc, staffLedger, customerAdjustment } = makeService({ customerExists: false });

      await expect(svc.createLinkedPenalty(user, makeCreateDto())).rejects.toBeInstanceOf(NotFoundException);
      expect(staffLedger.createTx).not.toHaveBeenCalled();
      expect(customerAdjustment.createTx).not.toHaveBeenCalled();
    });
  });

  describe('voidLinkedPenalty()', () => {
    it('voids the entry AND its paired customer credit together, in ONE transaction', async () => {
      const { svc, prisma, staffLedger, customerAdjustment } = makeService();
      prisma.staffLedgerEntry.findFirst.mockResolvedValue({
        id: ENTRY_ID,
        vendorId: VENDOR_ID,
        causedCustomerAdjustmentId: ADJUSTMENT_ID,
      });

      const dto = { version: 1, reason: 'Driver actually recorded it correctly' };
      const result = await svc.voidLinkedPenalty(user, ENTRY_ID, dto);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(staffLedger.voidEntryTx).toHaveBeenCalledWith(expect.anything(), user, ENTRY_ID, dto, {
        skipLinkGuard: true,
      });
      expect(customerAdjustment.voidAdjustmentTx).toHaveBeenCalledWith(
        expect.anything(),
        user,
        ADJUSTMENT_ID,
        dto.reason,
        { skipLinkGuard: true },
      );
      expect(result.customerBalance).toBe(1000);
      expect(result.customerAdjustment.status).toBe('VOIDED');
    });

    it('rejects with 404 when the entry does not exist in this vendor', async () => {
      const { svc, prisma, staffLedger, customerAdjustment } = makeService();
      prisma.staffLedgerEntry.findFirst.mockResolvedValue(null);

      await expect(
        svc.voidLinkedPenalty(user, ENTRY_ID, { version: 1, reason: 'x'.repeat(10) }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(staffLedger.voidEntryTx).not.toHaveBeenCalled();
      expect(customerAdjustment.voidAdjustmentTx).not.toHaveBeenCalled();
    });

    it('rejects with 400 when the entry has no linked customer credit', async () => {
      const { svc, prisma, staffLedger, customerAdjustment } = makeService();
      prisma.staffLedgerEntry.findFirst.mockResolvedValue({
        id: ENTRY_ID,
        vendorId: VENDOR_ID,
        causedCustomerAdjustmentId: null,
      });

      await expect(
        svc.voidLinkedPenalty(user, ENTRY_ID, { version: 1, reason: 'x'.repeat(10) }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(staffLedger.voidEntryTx).not.toHaveBeenCalled();
      expect(customerAdjustment.voidAdjustmentTx).not.toHaveBeenCalled();
    });
  });
});
