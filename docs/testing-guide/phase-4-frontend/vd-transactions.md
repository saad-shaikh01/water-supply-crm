# Phase 4 — Frontend Unit Tests: Vendor Dashboard — Transactions

**App:** vendor-dashboard
**Feature path:** `apps/vendor-dashboard/src/features/transactions/`
**Prerequisites:** TST-FE-001 helper exists

---

## TST-FE-008: VD TransactionList and PaymentRequestList tests

**Priority:** P1 High
**Type:** Component Unit Test

### File to Create
`apps/vendor-dashboard/src/features/transactions/components/__tests__/transaction-list.spec.tsx`

### Tasks

#### Task 1: Read TransactionList and PaymentRequestList sources
**Action:** Read:
- `apps/vendor-dashboard/src/features/transactions/components/transaction-list.tsx`
- `apps/vendor-dashboard/src/features/transactions/components/payment-request-list.tsx`

Identify column names, hook names, and status badge states.

#### Task 2: Write TransactionList tests
**Action:** Create the spec file with 3 test cases:

```typescript
jest.mock('../../hooks/use-transactions', () => ({
  useTransactions: () => ({
    data: {
      data: [
        { id: 't1', type: 'PAYMENT', amount: 500, balanceBefore: 500, balanceAfter: 0, createdAt: '2025-01-01', customer: { name: 'Ali Hassan' } },
        { id: 't2', type: 'DELIVERY', amount: 150, balanceBefore: 0, balanceAfter: 150, createdAt: '2025-01-02', customer: { name: 'Sara Khan' } },
      ],
      meta: { total: 2 },
    },
    isLoading: false,
  }),
}));
```

1. `it('should render transaction type and amount for each row')`
   - Assert PAYMENT and DELIVERY types visible

2. `it('should render balanceBefore and balanceAfter columns')`

3. `it('should show empty state when no transactions')`
   - Mock hook to return empty data

#### Task 3: Write PaymentRequestList tests
**Action:** Create `apps/vendor-dashboard/src/features/transactions/components/__tests__/payment-request-list.spec.tsx`

Write 3 test cases:

1. `it('should render PENDING payment requests with customer name and amount')`
2. `it('should render Approve and Reject buttons for PENDING requests')`
3. `it('should call approvePaymentRequest mutation when Approve is clicked')`
   - Mock `useApprovePaymentRequest` → `{ mutate: jest.fn() }`
   - Click Approve button
   - Assert mutation called with correct payment request ID

### Acceptance Criteria
- [ ] Both spec files exist
- [ ] Total 6 test cases (3 per file)
- [ ] All tests pass: `npx nx test vendor-dashboard --testFile=src/features/transactions/components/__tests__/transaction-list.spec.tsx`

---

## TST-FE-009: VD PaymentForm and AdjustmentForm component tests

**Priority:** P1 High
**Type:** Component Unit Test

### Files to Create
- `apps/vendor-dashboard/src/features/transactions/components/__tests__/payment-form.spec.tsx`
- `apps/vendor-dashboard/src/features/transactions/components/__tests__/adjustment-form.spec.tsx`

### Tasks

#### Task 1: Read both form components
**Action:** Read:
- `apps/vendor-dashboard/src/features/transactions/components/payment-form.tsx`
- `apps/vendor-dashboard/src/features/transactions/components/adjustment-form.tsx`

Note validation rules (amount must be positive), form fields, and mutation hooks.

#### Task 2: Write PaymentForm tests
**Action:** Create `payment-form.spec.tsx` with 3 test cases:

1. `it('should render amount and method fields')`
2. `it('should show validation error when amount is 0 or negative')`
   - Type `0` in amount field, submit
   - Assert error message
3. `it('should call recordPayment mutation with amount and customerId')`
   - Fill valid amount, submit
   - Assert mutation mock called

#### Task 3: Write AdjustmentForm tests
**Action:** Create `adjustment-form.spec.tsx` with 3 test cases:

1. `it('should render amount and note fields')`
2. `it('should allow negative amounts for credit adjustments')`
   - Type `-50` in amount field, submit
   - Assert mutation called (not blocked by validation)
3. `it('should show validation error when note is empty')`

### Acceptance Criteria
- [ ] Both files exist with 3 test cases each
- [ ] Negative amount is allowed in AdjustmentForm
- [ ] All tests pass
