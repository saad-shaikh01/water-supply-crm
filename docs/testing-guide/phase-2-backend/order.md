# Phase 2 — Backend Unit Tests: Order

**Module path:** `apps/api-backend/src/app/modules/order/`
**Prerequisites:** TST-INF-001, TST-INF-002, TST-INF-003

---

## TST-BE-017: OrderService.create() and status transition unit tests

**Priority:** P1 High
**Type:** Unit Test

### Context
`CustomerOrder` was added in session 15. Orders flow through statuses: PENDING → CONFIRMED → DISPATCHED → DELIVERED (or REJECTED). Status transitions must be validated — a DELIVERED order should not go back to PENDING.

### File to Create
`apps/api-backend/src/app/modules/order/order.service.spec.ts`

### Tasks

#### Task 1: Read OrderService source
**Action:** Read `apps/api-backend/src/app/modules/order/order.service.ts`
Identify:
- Constructor dependencies
- `create(vendorId, customerId, dto)` method and DTO fields
- Status transition method (`updateStatus`, `dispatch`, `confirm`, or similar)
- Initial status assigned on creation

#### Task 2: Write OrderService.create tests
**Action:** Create `apps/api-backend/src/app/modules/order/order.service.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrderService } from './order.service';
import { PrismaService } from '/* correct path */';
import { prismaMock } from '../../../test/prisma-mock';
import { createMockCustomer, createMockProduct, mockVendorId } from '../../../test/factories';

describe('OrderService', () => {
  let service: OrderService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        OrderService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = module.get<OrderService>(OrderService);
  });

  describe('create', () => {
    it('should create an order with PENDING status for a valid customer', async () => {
      const customer = createMockCustomer();
      prismaMock.customer.findFirst.mockResolvedValue(customer);
      prismaMock.customerOrder.create.mockResolvedValue({
        id: 'order-001',
        customerId: 'customer-test-001',
        status: 'PENDING',
        vendorId: mockVendorId,
      } as any);

      const result = await service.create(mockVendorId, 'customer-test-001', {
        productId: 'product-001',
        quantity: 2,
        note: 'Extra cold please',
      });

      expect(result.status).toBe('PENDING');
      expect(prismaMock.customerOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ vendorId: mockVendorId, status: 'PENDING' }),
        }),
      );
    });

    it('should throw NotFoundException when customer does not belong to vendor', async () => {
      prismaMock.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.create(mockVendorId, 'wrong-customer', { productId: 'p1', quantity: 1 }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
```

### Acceptance Criteria
- [ ] File exists with 2 test cases for `create`
- [ ] Status is verified as `PENDING` on creation
- [ ] All tests pass: `npx nx test api-backend --testFile=src/app/modules/order/order.service.spec.ts`

---

## TST-BE-018: OrderService.dispatch() unit tests

**Priority:** P1 High
**Type:** Unit Test

### File to Create/Modify
`apps/api-backend/src/app/modules/order/order.service.spec.ts` (add to existing file)

### Tasks

#### Task 1: Read dispatch method
**Action:** Re-read `apps/api-backend/src/app/modules/order/order.service.ts`
Find the dispatch method (may be `dispatch`, `updateStatus`, or `reject`).
Identify:
- What status it transitions to
- Whether it sends a notification (WhatsApp/FCM)
- What error is thrown if the order is already dispatched or rejected

#### Task 2: Write dispatch and reject tests
**Action:** Add to spec file:

```typescript
describe('dispatch (use actual method name)', () => {
  it('should update order status to DISPATCHED', async () => {
    const order = { id: 'order-001', status: 'CONFIRMED', vendorId: mockVendorId };
    prismaMock.customerOrder.findFirst.mockResolvedValue(order as any);
    prismaMock.customerOrder.update.mockResolvedValue({ ...order, status: 'DISPATCHED' } as any);

    const result = await service.dispatch(mockVendorId, 'order-001');

    expect(prismaMock.customerOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'DISPATCHED' }) }),
    );
  });

  it('should throw BadRequestException when trying to dispatch an already DELIVERED order', async () => {
    const order = { id: 'order-001', status: 'DELIVERED', vendorId: mockVendorId };
    prismaMock.customerOrder.findFirst.mockResolvedValue(order as any);

    await expect(service.dispatch(mockVendorId, 'order-001')).rejects.toThrow();
  });

  it('should throw NotFoundException when order does not belong to vendor', async () => {
    prismaMock.customerOrder.findFirst.mockResolvedValue(null);

    await expect(service.dispatch(mockVendorId, 'order-001')).rejects.toThrow(NotFoundException);
  });
});

describe('reject (use actual method name)', () => {
  it('should update order status to REJECTED with reason', async () => {
    const order = { id: 'order-001', status: 'PENDING', vendorId: mockVendorId };
    prismaMock.customerOrder.findFirst.mockResolvedValue(order as any);
    prismaMock.customerOrder.update.mockResolvedValue({ ...order, status: 'REJECTED' } as any);

    await service.reject(mockVendorId, 'order-001', 'Out of stock');

    expect(prismaMock.customerOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED' }) }),
    );
  });
});
```

### Acceptance Criteria
- [ ] 3 test cases for dispatch, 1 for reject
- [ ] Invalid status transition throws an error
- [ ] All tests pass
