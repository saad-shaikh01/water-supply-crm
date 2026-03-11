# Phase 4 — Frontend Unit Tests: Customer Portal — Payments

**App:** customer-portal
**Feature path:** `apps/customer-portal/src/features/payments/`
**Prerequisites:** CP render helper from TST-FE-012

---

## TST-FE-013: CP PaymentDialog (Raast QR flow) component tests

**Priority:** P0 Critical
**Type:** Component Unit Test

### Context
`PaymentDialog` is the most complex component in the customer portal. It has two tabs (Raast QR and Manual) and manages QR generation, polling for payment status, and showing status transitions. Tests verify the Raast QR tab renders and the Generate button triggers the mutation.

### File to Create
`apps/customer-portal/src/features/payments/components/__tests__/payment-dialog-raast.spec.tsx`

### Tasks

#### Task 1: Read PaymentDialog source
**Action:** Read `apps/customer-portal/src/features/payments/components/payment-dialog.tsx`
(You should already be familiar with this from the TST-BE-012 bug fix.)
Identify:
- Which hooks are used: `useInitiateRaastQr`, `usePaymentStatus`, `useSubmitManualPayment`, `usePaymentInfo`
- How the QR generation state transitions work (before QR → after QR generated)
- The status polling mechanism

#### Task 2: Write Raast QR flow tests
**Action:** Create `apps/customer-portal/src/features/payments/components/__tests__/payment-dialog-raast.spec.tsx`

```typescript
import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PaymentDialog } from '../payment-dialog';
import { renderWithProviders } from '../../../../test/render-with-providers';

const mockInitiateRaast = jest.fn();
jest.mock('../../hooks/use-payments', () => ({
  usePaymentInfo: () => ({ data: { raastId: '03001234567', instructions: '' } }),
  useInitiateRaastQr: () => ({ mutate: mockInitiateRaast, isPending: false }),
  usePaymentStatus: () => ({ data: null, isFetching: false }),
  useSubmitManualPayment: () => ({ mutate: jest.fn(), isPending: false }),
}));

jest.mock('nuqs', () => ({
  useQueryState: () => ['', jest.fn()],
  parseAsString: { withDefault: (d: string) => d },
}));

describe('PaymentDialog — Raast QR Tab', () => {
  const defaultProps = { open: true, onOpenChange: jest.fn(), suggestedAmount: 0 };

  it('should render the amount input and Raast QR tab when dialog is open', () => {
    renderWithProviders(<PaymentDialog {...defaultProps} />);

    expect(screen.getByPlaceholderText(/0.00/i)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /raast qr/i })).toBeInTheDocument();
  });

  it('should render Generate Raast QR button on Raast QR tab', () => {
    renderWithProviders(<PaymentDialog {...defaultProps} />);

    expect(screen.getByRole('button', { name: /generate raast qr/i })).toBeInTheDocument();
  });

  it('should call initiateRaast mutation with entered amount when Generate button is clicked', async () => {
    renderWithProviders(<PaymentDialog {...defaultProps} />);
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/0.00/i), '500');
    await user.click(screen.getByRole('button', { name: /generate raast qr/i }));

    await waitFor(() => {
      expect(mockInitiateRaast).toHaveBeenCalledWith(
        { amount: 500 },
        expect.anything(),
      );
    });
  });

  it('should show QR status UI after QR is generated', async () => {
    // Re-mock to simulate QR response state
    jest.doMock('../../hooks/use-payments', () => ({
      usePaymentInfo: () => ({ data: { raastId: '03001234567' } }),
      useInitiateRaastQr: () => ({
        mutate: (data: any, { onSuccess }: any) => {
          onSuccess({ id: 'pr-001', checkoutUrl: 'https://example.com', status: 'PROCESSING' });
        },
        isPending: false,
      }),
      usePaymentStatus: () => ({ data: { status: 'PROCESSING' }, isFetching: true }),
      useSubmitManualPayment: () => ({ mutate: jest.fn(), isPending: false }),
    }));

    renderWithProviders(<PaymentDialog {...defaultProps} suggestedAmount={300} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /generate raast qr/i }));

    // After mutation, should show status UI with status badge
    await waitFor(() => {
      expect(screen.getByText(/processing|waiting/i)).toBeInTheDocument();
    });
  });
});
```

### Acceptance Criteria
- [ ] File exists with 4 test cases
- [ ] Mutation mock is called with correct `{ amount: 500 }`
- [ ] All tests pass: `npx nx test customer-portal --testFile=src/features/payments/components/__tests__/payment-dialog-raast.spec.tsx`

---

## TST-FE-014: CP PaymentDialog (manual payment flow) component tests

**Priority:** P1 High
**Type:** Component Unit Test

### File to Create
`apps/customer-portal/src/features/payments/components/__tests__/payment-dialog-manual.spec.tsx`

### Tasks

#### Task 1: Understand manual payment tab
**Action:** Re-read `apps/customer-portal/src/features/payments/components/payment-dialog.tsx`
Focus on the MANUAL tab:
- The payment method selector (Raast, JazzCash, Easypaisa, Bank Transfer)
- Reference No input
- Screenshot file upload
- Customer Note textarea
- Submit for Review button

#### Task 2: Write manual payment tests
**Action:** Create `apps/customer-portal/src/features/payments/components/__tests__/payment-dialog-manual.spec.tsx`

Write 4 test cases:

1. `it('should show Manual tab with payment method options')`
   - Click the Manual tab
   - Assert method options (Raast, JazzCash, etc.) are visible

2. `it('should render reference number input and screenshot upload')`
   - Click Manual tab
   - Assert Reference/TID input is present
   - Assert file input is present

3. `it('should disable Submit button when amount or reference is empty')`
   - Click Manual tab without filling amount
   - Assert Submit for Review button is disabled

4. `it('should call submitManual mutation with FormData when form is valid and submitted')`
   - Mock `useSubmitManualPayment` → `{ mutate: mockSubmit }`
   - Fill amount, select method, fill reference
   - Click Submit for Review
   - Assert `mockSubmit` was called with a FormData argument

### Acceptance Criteria
- [ ] File exists with 4 test cases
- [ ] FormData call is verified in test 4
- [ ] All tests pass
