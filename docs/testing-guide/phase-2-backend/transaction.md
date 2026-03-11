# Phase 2 — Backend Unit Tests: Transaction

**Module path:** `apps/api-backend/src/app/modules/transaction/`
**Prerequisites:** TST-INF-001, TST-INF-002, TST-INF-003

---

## TST-BE-015: TransactionService ledger recording unit tests

**Priority:** P0 Critical
**Type:** Unit Test

### Context
Every financial event (payment, delivery, adjustment) creates a `Transaction` record with `balanceBefore` and `balanceAfter`. If the ledger math is wrong, customer balances drift silently. There is already a partial spec (`ledger-record-delivery.spec.ts`) — these tests extend and complete that coverage.

### Files to Read First
- `apps/api-backend/src/app/modules/transaction/ledger-record-delivery.spec.ts` (existing)
- `apps/api-backend/src/app/modules/transaction/transaction.service.ts`

### File to Create
`apps/api-backend/src/app/modules/transaction/transaction.service.spec.ts`

> Read the existing `ledger-record-delivery.spec.ts` first. This new file covers the service-level tests; do not duplicate what already exists.

### Tasks

#### Task 1: Read existing spec and TransactionService
**Action:** Read both files listed above.
From `transaction.service.ts` identify:
- `recordPayment(vendorId, customerId, amount, note?)` signature
- `recordAdjustment(vendorId, customerId, amount, note)` signature
- How `balanceBefore` is calculated (fetch current customer balance)
- How `balanceAfter` is computed

#### Task 2: Write recordPayment tests
**Action:** Create `apps/api-backend/src/app/modules/transaction/transaction.service.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { TransactionService } from './transaction.service';
import { PrismaService } from '/* correct path */';
import { prismaMock } from '../../../test/prisma-mock';
import { createMockCustomer, createMockTransaction, mockVendorId } from '../../../test/factories';

describe('TransactionService', () => {
  let service: TransactionService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        TransactionService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = module.get<TransactionService>(TransactionService);
  });

  describe('recordPayment', () => {
    it('should create a PAYMENT transaction with correct balanceBefore and balanceAfter', async () => {
      const customer = createMockCustomer({ balance: 500 });
      prismaMock.customer.findFirst.mockResolvedValue(customer);
      prismaMock.transaction.create.mockResolvedValue(
        createMockTransaction({ balanceBefore: 500, balanceAfter: 200 })
      );
      prismaMock.customer.update.mockResolvedValue({ ...customer, balance: 200 } as any);

      await service.recordPayment(mockVendorId, 'customer-test-001', 300);

      expect(prismaMock.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            balanceBefore: 500,
            balanceAfter: 200,
            amount: 300,
          }),
        }),
      );
    });

    it('should update the customer balance after recording the payment', async () => {
      const customer = createMockCustomer({ balance: 500 });
      prismaMock.customer.findFirst.mockResolvedValue(customer);
      prismaMock.transaction.create.mockResolvedValue(createMockTransaction());
      prismaMock.customer.update.mockResolvedValue({ ...customer, balance: 200 } as any);

      await service.recordPayment(mockVendorId, 'customer-test-001', 300);

      expect(prismaMock.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ balance: 200 }),
        }),
      );
    });

    it('should throw NotFoundException when customer does not belong to vendor', async () => {
      prismaMock.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.recordPayment(mockVendorId, 'wrong-customer', 300),
      ).rejects.toThrow();
    });
  });
});
```

### Acceptance Criteria
- [ ] File exists with 3 test cases for `recordPayment`
- [ ] The balance math (`balanceBefore - amount = balanceAfter`) is explicitly tested
- [ ] All tests pass: `npx nx test api-backend --testFile=src/app/modules/transaction/transaction.service.spec.ts`

---

## TST-BE-016: TransactionService balance calculation unit tests

**Priority:** P0 Critical
**Type:** Unit Test

### File to Create/Modify
`apps/api-backend/src/app/modules/transaction/transaction.service.spec.ts` (add to existing file)

### Tasks

#### Task 1: Read adjustment and delivery recording methods
**Action:** Re-read `apps/api-backend/src/app/modules/transaction/transaction.service.ts`
Find:
- `recordAdjustment` (credit or debit adjustment)
- `recordDelivery` (charges customer for delivered bottles)
- How positive vs negative adjustments affect balance

#### Task 2: Write recordAdjustment tests
**Action:** Add `describe('recordAdjustment')` to spec file:

```typescript
describe('recordAdjustment', () => {
  it('should increase balance for a debit adjustment (customer owes more)', async () => {
    const customer = createMockCustomer({ balance: 100 });
    prismaMock.customer.findFirst.mockResolvedValue(customer);
    prismaMock.transaction.create.mockResolvedValue(createMockTransaction({ balanceBefore: 100, balanceAfter: 150 }));
    prismaMock.customer.update.mockResolvedValue({ ...customer, balance: 150 } as any);

    await service.recordAdjustment(mockVendorId, 'customer-test-001', 50, 'Late fee');

    expect(prismaMock.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ balance: 150 }) }),
    );
  });

  it('should decrease balance for a credit adjustment (discount applied)', async () => {
    const customer = createMockCustomer({ balance: 200 });
    prismaMock.customer.findFirst.mockResolvedValue(customer);
    prismaMock.transaction.create.mockResolvedValue(createMockTransaction({ balanceBefore: 200, balanceAfter: 150 }));
    prismaMock.customer.update.mockResolvedValue({ ...customer, balance: 150 } as any);

    await service.recordAdjustment(mockVendorId, 'customer-test-001', -50, 'Goodwill credit');

    expect(prismaMock.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ balance: 150 }) }),
    );
  });
});
```

#### Task 3: Write recordDelivery tests
**Action:** Add `describe('recordDelivery')` to spec file:

```typescript
describe('recordDelivery', () => {
  it('should charge customer for delivered bottles at custom price if one exists', async () => {
    const customer = createMockCustomer({ balance: 0, basePrice: 150 });
    const customPrice = { price: 130 }; // customer has a cheaper custom price
    prismaMock.customer.findFirst.mockResolvedValue(customer);
    // Mock custom price lookup
    prismaMock.customerProductPrice?.findFirst?.mockResolvedValue(customPrice as any);
    prismaMock.transaction.create.mockResolvedValue(createMockTransaction({ amount: 260 }));
    prismaMock.customer.update.mockResolvedValue({ ...customer, balance: 260 } as any);

    await service.recordDelivery(mockVendorId, 'customer-test-001', 2);

    expect(prismaMock.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: 260 }) }),
    );
  });

  it('should use basePrice when no custom price exists for the customer', async () => {
    const customer = createMockCustomer({ balance: 0, basePrice: 150 });
    prismaMock.customer.findFirst.mockResolvedValue(customer);
    prismaMock.customerProductPrice?.findFirst?.mockResolvedValue(null);
    prismaMock.transaction.create.mockResolvedValue(createMockTransaction({ amount: 300 }));
    prismaMock.customer.update.mockResolvedValue({ ...customer, balance: 300 } as any);

    await service.recordDelivery(mockVendorId, 'customer-test-001', 2);

    expect(prismaMock.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: 300 }) }),
    );
  });
});
```

### Acceptance Criteria
- [ ] 2 test cases for `recordAdjustment` (debit and credit)
- [ ] 2 test cases for `recordDelivery` (custom price and base price)
- [ ] All tests pass
