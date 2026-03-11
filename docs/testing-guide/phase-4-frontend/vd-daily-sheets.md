# Phase 4 — Frontend Unit Tests: Vendor Dashboard — Daily Sheets

**App:** vendor-dashboard
**Feature path:** `apps/vendor-dashboard/src/features/daily-sheets/`
**Prerequisites:** TST-FE-001 (`render-with-providers.tsx` helper exists)

---

## TST-FE-006: VD SheetList component tests (filter, date range)

**Priority:** P0 Critical
**Type:** Component Unit Test

### Context
`SheetList` renders a table of daily sheets. It has date range filters (dateFrom/dateTo) and an Open/Closed status filter — both stored as URL query params via nuqs. Tests verify rendering and that filter state is passed to the data hook.

### File to Create
`apps/vendor-dashboard/src/features/daily-sheets/components/__tests__/sheet-list.spec.tsx`

### Tasks

#### Task 1: Read SheetList source
**Action:** Read `apps/vendor-dashboard/src/features/daily-sheets/components/sheet-list.tsx`
Identify:
- The hook it uses (`useDailySheets`)
- Column names rendered
- Filter inputs (status dropdown, date range)
- How it links to sheet detail (router.push or Link)

#### Task 2: Write SheetList tests
**Action:** Create `apps/vendor-dashboard/src/features/daily-sheets/components/__tests__/sheet-list.spec.tsx`

```typescript
import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import { SheetList } from '../sheet-list';
import { renderWithProviders } from '../../../../test/render-with-providers';

const mockUseDailySheets = jest.fn();
jest.mock('../../hooks/use-daily-sheets', () => ({
  useDailySheets: () => mockUseDailySheets(),
}));

jest.mock('nuqs', () => ({
  useQueryState: (key: string) => {
    const defaults: Record<string, any> = { status: '', dateFrom: '', dateTo: '', page: 1 };
    return [defaults[key] ?? '', jest.fn()];
  },
  parseAsString: { withDefault: (d: string) => d },
  parseAsInteger: { withDefault: (d: number) => d },
}));

const mockSheets = [
  { id: 's1', date: '2025-03-10', van: { plateNumber: 'ABC-123' }, status: 'OPEN', _count: { items: 10 } },
  { id: 's2', date: '2025-03-09', van: { plateNumber: 'XYZ-456' }, status: 'CLOSED', _count: { items: 8 } },
];

describe('SheetList', () => {
  it('should render sheet rows with date and van plate number', async () => {
    mockUseDailySheets.mockReturnValue({
      data: { data: mockSheets, meta: { total: 2 } },
      isLoading: false,
    });

    renderWithProviders(<SheetList />);

    await waitFor(() => {
      expect(screen.getByText('ABC-123')).toBeInTheDocument();
      expect(screen.getByText('XYZ-456')).toBeInTheDocument();
    });
  });

  it('should show OPEN and CLOSED status badges', async () => {
    mockUseDailySheets.mockReturnValue({
      data: { data: mockSheets, meta: { total: 2 } },
      isLoading: false,
    });

    renderWithProviders(<SheetList />);

    await waitFor(() => {
      expect(screen.getByText('OPEN')).toBeInTheDocument();
      expect(screen.getByText('CLOSED')).toBeInTheDocument();
    });
  });

  it('should show empty state when no sheets exist', async () => {
    mockUseDailySheets.mockReturnValue({
      data: { data: [], meta: { total: 0 } },
      isLoading: false,
    });

    renderWithProviders(<SheetList />);

    await waitFor(() => {
      expect(screen.getByText(/no sheets|no daily sheets/i)).toBeInTheDocument();
    });
  });

  it('should render Generate Sheet button', () => {
    mockUseDailySheets.mockReturnValue({ data: { data: [], meta: { total: 0 } }, isLoading: false });

    renderWithProviders(<SheetList />);

    expect(screen.getByRole('button', { name: /generate/i })).toBeInTheDocument();
  });
});
```

### Acceptance Criteria
- [ ] File exists with 4 test cases
- [ ] nuqs is mocked to prevent URL query state errors
- [ ] All tests pass: `npx nx test vendor-dashboard --testFile=src/features/daily-sheets/components/__tests__/sheet-list.spec.tsx`

---

## TST-FE-007: VD SheetDetail delivery item update tests

**Priority:** P1 High
**Type:** Component Unit Test

### Context
`SheetDetail` shows delivery items for a specific daily sheet. Drivers/vendors can update each item. Tests verify the delivery dialog opens, inputs are filled, and the mutation is called.

### File to Create
`apps/vendor-dashboard/src/features/daily-sheets/components/__tests__/sheet-detail.spec.tsx`

### Tasks

#### Task 1: Read SheetDetail source
**Action:** Read `apps/vendor-dashboard/src/features/daily-sheets/components/sheet-detail.tsx`
Identify:
- The hook used to fetch sheet detail
- How delivery items are displayed
- The update mutation hook
- How the edit dialog is triggered (button click, row click)

#### Task 2: Write SheetDetail tests
**Action:** Create `apps/vendor-dashboard/src/features/daily-sheets/components/__tests__/sheet-detail.spec.tsx`

Write 3 test cases:

1. `it('should render delivery items with customer names')`
   - Mock `useSheet` or equivalent with sheet data containing items
   - Assert customer names are in the table

2. `it('should open update dialog when edit button is clicked')`
   - Click an edit/update button on a row
   - Assert a dialog/modal opens (look for role=dialog)

3. `it('should call updateDeliveryItem mutation when form is submitted in the dialog')`
   - Open dialog, fill in filledDropped and status fields
   - Click save/submit
   - Assert mutation mock was called

Mock all hooks. Use `userEvent` for interactions.

### Acceptance Criteria
- [ ] File exists with 3 test cases
- [ ] All tests pass
