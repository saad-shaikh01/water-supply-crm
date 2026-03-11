# Phase 4 — Frontend Unit Tests: Vendor Dashboard — Customers

**App:** vendor-dashboard
**Feature path:** `apps/vendor-dashboard/src/features/customers/`
**Prerequisites:** TST-INF-004, `render-with-providers.tsx` helper created in TST-FE-001

---

## TST-FE-003: VD CustomerList component tests (render, filter, pagination)

**Priority:** P0 Critical
**Type:** Component Unit Test

### Context
`CustomerList` is the most-used page on the vendor dashboard. It renders a table, supports search, and paginates via `nuqs` URL state. Tests verify data rendering, empty state, and pagination controls.

### File to Create
`apps/vendor-dashboard/src/features/customers/components/__tests__/customer-list.spec.tsx`

### Tasks

#### Task 1: Read CustomerList source
**Action:** Read `apps/vendor-dashboard/src/features/customers/components/customer-list.tsx`
Identify:
- The hook used to fetch customers (`useCustomers`)
- What columns are rendered (name, phone, balance, etc.)
- Whether it uses `DataTable` component
- What the empty state looks like

#### Task 2: Mock the useCustomers hook
**Action:** Create `apps/vendor-dashboard/src/features/customers/components/__tests__/customer-list.spec.tsx`

```typescript
import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import { CustomerList } from '../customer-list';
import { renderWithProviders } from '../../../../test/render-with-providers';

// Mock the hook
const mockUseCustomers = jest.fn();
jest.mock('../../hooks/use-customers', () => ({
  useCustomers: () => mockUseCustomers(),
}));

// Mock nuqs (URL state)
jest.mock('nuqs', () => ({
  useQueryState: jest.fn().mockImplementation((key, parser) => {
    if (key === 'search') return ['', jest.fn()];
    if (key === 'page') return [1, jest.fn()];
    return ['', jest.fn()];
  }),
  parseAsString: { withDefault: (d: string) => ({ withDefault: () => [d, jest.fn()] }) },
  parseAsInteger: { withDefault: (d: number) => [d, jest.fn()] },
}));

const mockCustomers = [
  { id: 'c1', name: 'Ali Hassan', phone: '03001234567', balance: 500, isActive: true },
  { id: 'c2', name: 'Sara Khan', phone: '03009876543', balance: 0, isActive: true },
];

describe('CustomerList', () => {
  it('should render customer names in the table', async () => {
    mockUseCustomers.mockReturnValue({
      data: { data: mockCustomers, meta: { total: 2 } },
      isLoading: false,
    });

    renderWithProviders(<CustomerList />);

    await waitFor(() => {
      expect(screen.getByText('Ali Hassan')).toBeInTheDocument();
      expect(screen.getByText('Sara Khan')).toBeInTheDocument();
    });
  });

  it('should show loading state when isLoading is true', () => {
    mockUseCustomers.mockReturnValue({
      data: undefined,
      isLoading: true,
    });

    renderWithProviders(<CustomerList />);

    // Assert loading indicator is present (skeleton, spinner, or loading text)
    expect(screen.getByText(/loading/i) || document.querySelector('[data-loading]')).toBeTruthy();
  });

  it('should show empty state when no customers exist', async () => {
    mockUseCustomers.mockReturnValue({
      data: { data: [], meta: { total: 0 } },
      isLoading: false,
    });

    renderWithProviders(<CustomerList />);

    await waitFor(() => {
      expect(screen.getByText(/no customers/i)).toBeInTheDocument();
    });
  });

  it('should render Add Customer button', async () => {
    mockUseCustomers.mockReturnValue({ data: { data: [], meta: { total: 0 } }, isLoading: false });

    renderWithProviders(<CustomerList />);

    expect(screen.getByRole('button', { name: /add customer/i })).toBeInTheDocument();
  });
});
```

### Acceptance Criteria
- [ ] File exists with 4 test cases
- [ ] Hook is mocked — no real API calls
- [ ] All tests pass: `npx nx test vendor-dashboard --testFile=src/features/customers/components/__tests__/customer-list.spec.tsx`

---

## TST-FE-004: VD CustomerForm (create/edit) component tests

**Priority:** P1 High
**Type:** Component Unit Test

### File to Create
`apps/vendor-dashboard/src/features/customers/components/__tests__/customer-form.spec.tsx`

### Tasks

#### Task 1: Read CustomerForm source
**Action:** Read `apps/vendor-dashboard/src/features/customers/components/customer-form.tsx`
Identify:
- Form fields (name, phone, address, bottleCount, paymentType, etc.)
- Zod schema file for validation
- Whether the form handles both create and edit modes
- The mutation hooks used

#### Task 2: Write CustomerForm tests
**Action:** Create `apps/vendor-dashboard/src/features/customers/components/__tests__/customer-form.spec.tsx`

Write 4 test cases:

1. `it('should render all required form fields')`
   - Assert name, phone, address fields are present

2. `it('should show validation errors when required fields are empty and form is submitted')`
   - Click submit without filling anything
   - Assert at least one error message appears

3. `it('should call createCustomer mutation with form data on valid submit')`
   - Fill all required fields
   - Submit form
   - Assert mock mutation was called with correct data

4. `it('should pre-fill fields with existing customer data in edit mode')`
   - Pass a `customer` prop (or however edit mode is triggered)
   - Assert fields are pre-filled

Mock:
- `useCreateCustomer` → `{ mutate: jest.fn(), isPending: false }`
- `useUpdateCustomer` → `{ mutate: jest.fn(), isPending: false }`

### Acceptance Criteria
- [ ] File exists with 4 test cases
- [ ] Mutation mock is called with the submitted data
- [ ] All tests pass

---

## TST-FE-005: VD CustomerDetail tabs component tests

**Priority:** P2 Medium
**Type:** Component Unit Test

### File to Create
`apps/vendor-dashboard/src/features/customers/components/__tests__/customer-detail.spec.tsx`

### Tasks

#### Task 1: Read CustomerDetail source
**Action:** Read `apps/vendor-dashboard/src/features/customers/components/customer-detail.tsx`
Identify:
- The tab names (Transactions, Deliveries, Schedule, etc.)
- What hooks each tab uses
- How the customer ID is passed (prop or URL param)

#### Task 2: Write CustomerDetail tests
**Action:** Create the spec file with 3 test cases:

1. `it('should render customer name and balance in the header')`
   - Mock `useCustomer` to return a mock customer
   - Assert name and balance displayed

2. `it('should render tab navigation')`
   - Assert each tab label is visible

3. `it('should switch content when a tab is clicked')`
   - Click on a tab
   - Assert corresponding content is shown (or other tab content is hidden)

### Acceptance Criteria
- [ ] File exists with 3 test cases
- [ ] All tests pass
