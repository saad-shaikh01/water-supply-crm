# Phase 4 — Frontend Unit Tests: Admin Panel — Vendors

**App:** admin-panel
**Feature path:** `apps/admin-panel/src/features/vendors/`
**Prerequisites:** AP render helper from TST-FE-017

---

## TST-FE-018: AP VendorList and VendorForm component tests

**Priority:** P1 High
**Type:** Component Unit Test

### Context
The admin panel's main feature is managing vendors. `VendorList` shows all vendors with their active status; `VendorForm` handles create/edit. Tests verify CRUD UI flows.

### Files to Create
- `apps/admin-panel/src/features/vendors/components/__tests__/vendor-list.spec.tsx`
- `apps/admin-panel/src/features/vendors/components/__tests__/vendor-form.spec.tsx`

### Tasks

#### Task 1: Read VendorList and VendorForm
**Action:** Read:
- `apps/admin-panel/src/features/vendors/components/vendor-list.tsx`
- `apps/admin-panel/src/features/vendors/components/vendor-form.tsx`
- `apps/admin-panel/src/features/vendors/hooks/use-vendors.ts`

Identify:
- Hook names: `useVendors`, `useCreateVendor`, `useUpdateVendor`, `useToggleVendorActive`
- Column names in the vendor list
- Form fields in VendorForm (name, email, phone, etc.)
- How active/inactive state is toggled (switch, button)

#### Task 2: Write VendorList tests
**Action:** Create `apps/admin-panel/src/features/vendors/components/__tests__/vendor-list.spec.tsx`

```typescript
import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VendorList } from '../vendor-list';
import { renderWithProviders } from '../../../../test/render-with-providers';

const mockToggle = jest.fn();

jest.mock('../../hooks/use-vendors', () => ({
  useVendors: () => ({
    data: [
      { id: 'v1', name: 'Karachi Water Co.', email: 'khi@water.com', isActive: true },
      { id: 'v2', name: 'Lahore Water Co.', email: 'lhr@water.com', isActive: false },
    ],
    isLoading: false,
  }),
  useToggleVendorActive: () => ({ mutate: mockToggle, isPending: false }),
}));

// Mock nuqs
jest.mock('nuqs', () => ({
  useQueryState: () => ['', jest.fn()],
  parseAsString: { withDefault: (d: string) => d },
}));

describe('VendorList', () => {
  it('should render all vendors with names and email', async () => {
    renderWithProviders(<VendorList />);

    await waitFor(() => {
      expect(screen.getByText('Karachi Water Co.')).toBeInTheDocument();
      expect(screen.getByText('Lahore Water Co.')).toBeInTheDocument();
    });
  });

  it('should show active/inactive status for each vendor', async () => {
    renderWithProviders(<VendorList />);

    await waitFor(() => {
      // Active vendor should show active badge; inactive should show inactive
      expect(screen.getByText(/active/i)).toBeInTheDocument();
    });
  });

  it('should call toggleActive mutation when toggle button is clicked', async () => {
    renderWithProviders(<VendorList />);
    const user = userEvent.setup();

    // Find and click the toggle button for the first vendor
    const toggleButtons = screen.getAllByRole('switch') // or button with toggle label
      || screen.getAllByRole('button', { name: /disable|enable|toggle/i });
    await user.click(toggleButtons[0]);

    await waitFor(() => {
      expect(mockToggle).toHaveBeenCalledWith('v1', expect.anything());
    });
  });

  it('should render Add Vendor button', () => {
    renderWithProviders(<VendorList />);
    expect(screen.getByRole('button', { name: /add vendor/i })).toBeInTheDocument();
  });
});
```

#### Task 3: Write VendorForm tests
**Action:** Create `apps/admin-panel/src/features/vendors/components/__tests__/vendor-form.spec.tsx`

```typescript
const mockCreate = jest.fn();
jest.mock('../../hooks/use-vendors', () => ({
  useCreateVendor: () => ({ mutate: mockCreate, isPending: false }),
  useUpdateVendor: () => ({ mutate: jest.fn(), isPending: false }),
}));
```

Write 3 test cases:

1. `it('should render vendor name, email, and phone fields')`

2. `it('should show validation error when email is invalid')`
   - Type invalid email
   - Submit
   - Assert error

3. `it('should call createVendor mutation with form data on valid submit')`
   - Fill name, email, phone
   - Submit
   - Assert `mockCreate` called with `expect.objectContaining({ name: '...', email: '...' })`

### Acceptance Criteria
- [ ] Both spec files exist
- [ ] VendorList has 4 test cases, VendorForm has 3 (7 total)
- [ ] All tests pass: `npx nx test admin-panel --testFile=src/features/vendors/components/__tests__/vendor-list.spec.tsx`
