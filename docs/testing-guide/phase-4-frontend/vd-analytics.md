# Phase 4 — Frontend Unit Tests: Vendor Dashboard — Analytics

**App:** vendor-dashboard
**Feature path:** `apps/vendor-dashboard/src/features/analytics/`
**Prerequisites:** TST-FE-001 helper exists

---

## TST-FE-010: VD AnalyticsTabs component tests (date range, tab switch)

**Priority:** P2 Medium
**Type:** Component Unit Test

### Context
The analytics page has 4 tabs (Financial, Deliveries, Customers, Staff) and a date range picker. Tests verify tab switching works, each tab renders its content, and the export button is present.

### File to Create
`apps/vendor-dashboard/src/features/analytics/components/__tests__/analytics-tabs.spec.tsx`

### Tasks

#### Task 1: Read analytics components
**Action:** Read:
- `apps/vendor-dashboard/src/features/analytics/components/financial-tab.tsx`
- `apps/vendor-dashboard/src/features/analytics/components/deliveries-tab.tsx`
- `apps/vendor-dashboard/src/app/dashboard/analytics/page.tsx`

Identify:
- How the tabs are rendered (Tabs component from UI lib)
- Tab trigger labels
- The date range picker component
- Which hooks each tab uses

#### Task 2: Write analytics tab tests
**Action:** Create `apps/vendor-dashboard/src/features/analytics/components/__tests__/analytics-tabs.spec.tsx`

```typescript
import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../../test/render-with-providers';

// Mock all analytics hooks
jest.mock('../../hooks/use-analytics', () => ({
  useFinancialAnalytics: () => ({ data: null, isLoading: false }),
  useDeliveryAnalytics: () => ({ data: null, isLoading: false }),
  useCustomerAnalytics: () => ({ data: null, isLoading: false }),
  useStaffAnalytics: () => ({ data: null, isLoading: false }),
}));

// Mock nuqs
jest.mock('nuqs', () => ({
  useQueryState: (key: string) => ['', jest.fn()],
  parseAsString: { withDefault: (d: string) => d },
}));

// Import the analytics page or a wrapping component that contains all tabs
// Adjust this import based on where the tabs are defined
import AnalyticsPage from '../../../../app/dashboard/analytics/page';

describe('Analytics Tabs', () => {
  it('should render all four tab labels: Financial, Deliveries, Customers, Staff', async () => {
    renderWithProviders(<AnalyticsPage />);

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /financial/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /deliveries/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /customers/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /staff/i })).toBeInTheDocument();
    });
  });

  it('should switch to Deliveries tab content when Deliveries tab is clicked', async () => {
    renderWithProviders(<AnalyticsPage />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('tab', { name: /deliveries/i }));

    await waitFor(() => {
      // Assert content specific to the deliveries tab is shown
      // Look for a heading or unique text in that tab's content
      expect(screen.getByRole('tab', { name: /deliveries/i })).toHaveAttribute('aria-selected', 'true');
    });
  });

  it('should render Export section with CSV and PDF buttons', async () => {
    renderWithProviders(<AnalyticsPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /csv|export csv/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /pdf|export pdf/i })).toBeInTheDocument();
    });
  });
});
```

> Adjust the import path to the actual analytics page or component that contains all tabs.

### Acceptance Criteria
- [ ] File exists with 3 test cases
- [ ] Tab switch test verifies the selected tab's aria-selected attribute
- [ ] All tests pass: `npx nx test vendor-dashboard --testFile=src/features/analytics/components/__tests__/analytics-tabs.spec.tsx`
