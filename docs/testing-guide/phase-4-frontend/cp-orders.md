# Phase 4 — Frontend Unit Tests: Customer Portal — Orders

**App:** customer-portal
**Feature path:** `apps/customer-portal/src/features/orders/`
**Prerequisites:** CP render helper from TST-FE-012

---

## TST-FE-015: CP PlaceOrderDialog component tests

**Priority:** P1 High
**Type:** Component Unit Test

### Context
`PlaceOrderDialog` lets customers place new water bottle orders. Tests verify product selection, quantity input, and mutation call.

### File to Create
`apps/customer-portal/src/features/orders/components/__tests__/place-order-dialog.spec.tsx`

### Tasks

#### Task 1: Read PlaceOrderDialog source
**Action:** Read `apps/customer-portal/src/features/orders/components/place-order-dialog.tsx`
Identify:
- The hooks used: `usePlaceOrder`, `useProducts` (portal products list)
- Form fields: product selector, quantity input, note textarea
- Whether the dialog is controlled via `open`/`onOpenChange` props

#### Task 2: Write PlaceOrderDialog tests
**Action:** Create `apps/customer-portal/src/features/orders/components/__tests__/place-order-dialog.spec.tsx`

```typescript
import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlaceOrderDialog } from '../place-order-dialog';
import { renderWithProviders } from '../../../../test/render-with-providers';

const mockPlaceOrder = jest.fn();

jest.mock('../../hooks/use-orders', () => ({
  usePlaceOrder: () => ({ mutate: mockPlaceOrder, isPending: false }),
}));

jest.mock('../../../wallet/hooks/use-wallet', () => ({
  useProducts: () => ({
    data: [
      { id: 'p1', name: '19L Water Bottle', basePrice: 150 },
      { id: 'p2', name: '5L Water Bottle', basePrice: 60 },
    ],
    isLoading: false,
  }),
}));

// Adjust the products hook import to match actual import in component

describe('PlaceOrderDialog', () => {
  const defaultProps = { open: true, onOpenChange: jest.fn() };

  it('should render product selector with available products', async () => {
    renderWithProviders(<PlaceOrderDialog {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('19L Water Bottle')).toBeInTheDocument();
    });
  });

  it('should render quantity input', () => {
    renderWithProviders(<PlaceOrderDialog {...defaultProps} />);

    expect(screen.getByLabelText(/quantity/i) || screen.getByRole('spinbutton')).toBeInTheDocument();
  });

  it('should disable Place Order button when quantity is 0', async () => {
    renderWithProviders(<PlaceOrderDialog {...defaultProps} />);

    const button = screen.getByRole('button', { name: /place order/i });
    expect(button).toBeDisabled();
  });

  it('should call placeOrder mutation with productId and quantity when form is submitted', async () => {
    renderWithProviders(<PlaceOrderDialog {...defaultProps} />);
    const user = userEvent.setup();

    // Select product (if it's a select/dropdown)
    // Type quantity
    await user.clear(screen.getByRole('spinbutton'));
    await user.type(screen.getByRole('spinbutton'), '2');
    await user.click(screen.getByRole('button', { name: /place order/i }));

    await waitFor(() => {
      expect(mockPlaceOrder).toHaveBeenCalledWith(
        expect.objectContaining({ quantity: 2 }),
        expect.anything(),
      );
    });
  });
});
```

> Adjust the products hook mock import path based on what `place-order-dialog.tsx` actually imports.

### Acceptance Criteria
- [ ] File exists with 4 test cases
- [ ] Mutation is called with `{ quantity: 2 }` minimum
- [ ] All tests pass: `npx nx test customer-portal --testFile=src/features/orders/components/__tests__/place-order-dialog.spec.tsx`
