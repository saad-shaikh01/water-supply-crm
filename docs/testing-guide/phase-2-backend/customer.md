# Phase 2 — Backend Unit Tests: Customer

**Module path:** `apps/api-backend/src/app/modules/customer/`
**Prerequisites:** TST-INF-001, TST-INF-002, TST-INF-003

---

## TST-BE-005: CustomerService.findAll() with pagination unit tests

**Priority:** P0 Critical
**Type:** Unit Test

### Context
`CustomerService.findAll()` is called on every page load of the customer list in vendor-dashboard. It must correctly filter by `vendorId`, apply pagination, and return a `{ data, meta }` shape. Multi-tenant isolation is critical here.

### File to Create
`apps/api-backend/src/app/modules/customer/customer.service.spec.ts`

### Tasks

#### Task 1: Read CustomerService source
**Action:** Read `apps/api-backend/src/app/modules/customer/customer.service.ts`
Identify:
- All constructor-injected dependencies
- The exact signature of `findAll(vendorId, paginationDto)`
- How it builds the Prisma `where` clause (vendorId filter + optional search)
- The return shape `{ data: Customer[], meta: { total, page, limit } }`

#### Task 2: Write findAll test suite
**Action:** Create `apps/api-backend/src/app/modules/customer/customer.service.spec.ts`

Write a `describe('CustomerService')` with nested `describe('findAll')`:

```typescript
describe('findAll', () => {
  it('should return paginated customers for the given vendorId', async () => {
    const mockCustomers = [createMockCustomer(), createMockCustomer({ id: 'customer-002' })];
    prismaMock.customer.findMany.mockResolvedValue(mockCustomers);
    prismaMock.customer.count.mockResolvedValue(2);

    const result = await service.findAll(mockVendorId, { page: 1, limit: 10 });

    expect(result.data).toHaveLength(2);
    expect(result.meta.total).toBe(2);
    expect(prismaMock.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ vendorId: mockVendorId }),
      }),
    );
  });

  it('should NOT return customers from a different vendorId', async () => {
    prismaMock.customer.findMany.mockResolvedValue([]);
    prismaMock.customer.count.mockResolvedValue(0);

    const result = await service.findAll('other-vendor', { page: 1, limit: 10 });

    expect(result.data).toHaveLength(0);
    expect(prismaMock.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ vendorId: 'other-vendor' }),
      }),
    );
  });

  it('should apply correct skip/take for page 2', async () => {
    prismaMock.customer.findMany.mockResolvedValue([]);
    prismaMock.customer.count.mockResolvedValue(15);

    await service.findAll(mockVendorId, { page: 2, limit: 10 });

    expect(prismaMock.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10 }),
    );
  });
});
```

### Acceptance Criteria
- [ ] File exists with at minimum 3 test cases for `findAll`
- [ ] All tests pass: `npx nx test api-backend --testFile=src/app/modules/customer/customer.service.spec.ts`

---

## TST-BE-006: CustomerService.create() and update() unit tests

**Priority:** P0 Critical
**Type:** Unit Test

### File to Create/Modify
`apps/api-backend/src/app/modules/customer/customer.service.spec.ts` (add to existing file)

### Tasks

#### Task 1: Read create and update method signatures
**Action:** Re-read `apps/api-backend/src/app/modules/customer/customer.service.ts`
Focus on:
- `create(vendorId, dto)` — what fields does the DTO contain? Does it hash anything? Does it auto-generate a portal account?
- `update(id, vendorId, dto)` — does it verify vendorId ownership before updating?

#### Task 2: Write create tests
**Action:** Add `describe('create')` to the existing spec file:

```typescript
describe('create', () => {
  it('should create a customer with the given vendorId', async () => {
    const dto = { name: 'New Customer', phone: '0300111', /* other required fields */ };
    const expected = createMockCustomer({ name: 'New Customer' });
    prismaMock.customer.create.mockResolvedValue(expected);

    const result = await service.create(mockVendorId, dto);

    expect(result.name).toBe('New Customer');
    expect(prismaMock.customer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ vendorId: mockVendorId }),
      }),
    );
  });
});
```

#### Task 3: Write update tests
**Action:** Add `describe('update')` to the existing spec file:

```typescript
describe('update', () => {
  it('should update customer fields when vendorId matches', async () => {
    const existing = createMockCustomer();
    prismaMock.customer.findFirst.mockResolvedValue(existing);
    prismaMock.customer.update.mockResolvedValue({ ...existing, name: 'Updated Name' });

    const result = await service.update('customer-test-001', mockVendorId, { name: 'Updated Name' });

    expect(result.name).toBe('Updated Name');
  });

  it('should throw NotFoundException when customer does not belong to vendorId', async () => {
    prismaMock.customer.findFirst.mockResolvedValue(null);

    await expect(
      service.update('customer-test-001', 'wrong-vendor', { name: 'X' }),
    ).rejects.toThrow();
  });
});
```

### Acceptance Criteria
- [ ] `describe('create')` with 1 test and `describe('update')` with 2 tests added
- [ ] All tests pass

---

## TST-BE-007: CustomerService custom pricing CRUD unit tests

**Priority:** P1 High
**Type:** Unit Test

### Context
Vendors can set per-customer product prices that override base prices. These tests verify the custom price is stored with the correct `customerId` + `vendorId` and that deletion works safely.

### File to Create/Modify
`apps/api-backend/src/app/modules/customer/customer.service.spec.ts` (add to existing file)

### Tasks

#### Task 1: Read custom pricing methods
**Action:** Re-read `apps/api-backend/src/app/modules/customer/customer.service.ts`
Find methods related to custom pricing (likely `addCustomPrice`, `removeCustomPrice`, or similar). Note the exact method names and Prisma models used (likely `CustomerProductPrice` or similar model name — check schema if unsure).

#### Task 2: Write custom pricing tests
**Action:** Add `describe('addCustomPrice')` and `describe('removeCustomPrice')` blocks (use actual method names from Task 1):

For `addCustomPrice`:
- `it('should create custom price entry for customer and product')`
- `it('should throw NotFoundException when customer does not belong to vendorId')`

For `removeCustomPrice`:
- `it('should delete custom price entry by id')`
- `it('should throw NotFoundException when price entry does not exist')`

### Acceptance Criteria
- [ ] 4 test cases added covering custom pricing CRUD
- [ ] All tests pass

---

## TST-BE-008: CustomerService.getStatement() unit tests

**Priority:** P1 High
**Type:** Unit Test

### Context
`getStatement()` generates a financial summary for a customer over a date range. It must aggregate deliveries, payments, and adjustments correctly. This powers the statement PDF download feature.

### File to Create/Modify
`apps/api-backend/src/app/modules/customer/customer.service.spec.ts` (add to existing file)

### Tasks

#### Task 1: Read getStatement implementation
**Action:** Re-read `apps/api-backend/src/app/modules/customer/customer.service.ts`
Find `getStatement` (or similar method name). Note:
- What Prisma models it queries (transactions, daily sheets)
- What date range params it accepts
- The shape of the returned data

#### Task 2: Write getStatement tests
**Action:** Add `describe('getStatement')`:

```typescript
describe('getStatement', () => {
  it('should return transactions within the given date range for the customer', async () => {
    const mockTransactions = [createMockTransaction(), createMockTransaction({ id: 'txn-002' })];
    prismaMock.transaction.findMany.mockResolvedValue(mockTransactions);

    const result = await service.getStatement('customer-test-001', mockVendorId, {
      from: new Date('2025-01-01'),
      to: new Date('2025-01-31'),
    });

    expect(prismaMock.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          customerId: 'customer-test-001',
          createdAt: expect.objectContaining({
            gte: expect.any(Date),
            lte: expect.any(Date),
          }),
        }),
      }),
    );
  });

  it('should throw NotFoundException when customer does not belong to vendor', async () => {
    prismaMock.customer.findFirst.mockResolvedValue(null);
    await expect(service.getStatement('customer-001', 'wrong-vendor', { from: new Date(), to: new Date() })).rejects.toThrow();
  });
});
```

### Acceptance Criteria
- [ ] 2 test cases for `getStatement` added
- [ ] All tests pass
