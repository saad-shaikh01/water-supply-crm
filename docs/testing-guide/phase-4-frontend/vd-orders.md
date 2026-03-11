# Phase 4 — Frontend Unit Tests: Vendor Dashboard — Orders

**App:** vendor-dashboard
**Feature path:** `apps/vendor-dashboard/src/features/orders/`
**Prerequisites:** TST-FE-001 helper exists

---

## TST-FE-011: VD OrderList and OrderDispatchDrawer component tests

**Priority:** P1 High
**Type:** Component Unit Test

### Files to Create
- `apps/vendor-dashboard/src/features/orders/components/__tests__/order-list.spec.tsx`
- `apps/vendor-dashboard/src/features/orders/components/__tests__/order-dispatch-drawer.spec.tsx`

### Tasks

#### Task 1: Read order components
**Action:** Read:
- `apps/vendor-dashboard/src/features/orders/hooks/use-orders.ts` (understand data shape)
- `apps/vendor-dashboard/src/features/orders/components/order-dispatch-drawer.tsx`
- `apps/vendor-dashboard/src/features/orders/components/order-reject-dialog.tsx`
- The page at `apps/vendor-dashboard/src/app/dashboard/orders/page.tsx`

Identify:
- The hook that fetches orders
- Order status values (PENDING, CONFIRMED, DISPATCHED, etc.)
- What action buttons exist per status

#### Task 2: Write OrderList tests
**Action:** Create `apps/vendor-dashboard/src/features/orders/components/__tests__/order-list.spec.tsx`

Mock the orders hook:
```typescript
jest.mock('../../hooks/use-orders', () => ({
  useOrders: () => ({
    data: {
      data: [
        { id: 'o1', status: 'PENDING', customer: { name: 'Ali Hassan' }, createdAt: '2025-03-01', quantity: 2, product: { name: '19L Water Bottle' } },
        { id: 'o2', status: 'DISPATCHED', customer: { name: 'Sara Khan' }, createdAt: '2025-03-02', quantity: 1, product: { name: '19L Water Bottle' } },
      ],
      meta: { total: 2 },
    },
    isLoading: false,
  }),
}));
```

Write 3 test cases:

1. `it('should render order rows with customer name and status')`
   - Assert 'Ali Hassan' and 'PENDING' are visible
   - Assert 'Sara Khan' and 'DISPATCHED' are visible

2. `it('should render Dispatch button for PENDING orders')`
   - Assert a dispatch/confirm button is present for the PENDING order row

3. `it('should show empty state when no orders')`
   - Mock empty data, assert empty text

#### Task 3: Write OrderDispatchDrawer tests
**Action:** Create `apps/vendor-dashboard/src/features/orders/components/__tests__/order-dispatch-drawer.spec.tsx`

```typescript
jest.mock('../../hooks/use-orders', () => ({
  useDispatchOrder: () => ({ mutate: jest.fn(), isPending: false }),
}));
```

Write 2 test cases:

1. `it('should render order details in the drawer when open=true')`
   - Render `<OrderDispatchDrawer open={true} order={mockOrder} onClose={jest.fn()} />`
   - Assert order customer name is visible

2. `it('should call dispatch mutation when Dispatch button is clicked')`
   - Render open drawer
   - Click dispatch button
   - Assert mutation mock was called with correct order ID

### Acceptance Criteria
- [ ] Both spec files exist
- [ ] Total 5 test cases
- [ ] All tests pass: `npx nx test vendor-dashboard --testFile=src/features/orders/components/__tests__/order-list.spec.tsx`
