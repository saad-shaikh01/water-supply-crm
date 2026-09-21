import { fireEvent, render, screen } from '@testing-library/react';
import { CustomerDetail } from './customer-detail';

/**
 * Wiring of the "Charges & Credits" tab into the (large) customer detail page: it must appear
 * ONLY for holders of `customer_financial_adjustments:view`, must not disturb the existing tabs,
 * and must hand the tab the page's customer id. The tab's own behaviour is covered in
 * features/customer-adjustments/components/customer-adjustments-tab.spec.tsx — everything the
 * page pulls in is stubbed here so this stays a wiring test.
 */

const mockGranted = new Set<string>();
jest.mock('../../authz/hooks/use-can', () => ({
  useCan: jest.fn((permission: string) => mockGranted.has(permission)),
}));

jest.mock('next/navigation', () => ({ useRouter: () => ({ back: jest.fn() }) }));
jest.mock('nuqs/adapters/next/app', () => ({ NuqsAdapter: ({ children }: { children: unknown }) => children }));
jest.mock('../api/customers.api', () => ({ customersApi: {} }));

jest.mock('../hooks/use-customers', () => {
  const idle = { data: undefined, isLoading: false, isError: false, mutate: jest.fn(), isPending: false };
  return {
    useCustomer: () => ({
      isLoading: false,
      data: {
        id: 'cust-1',
        name: 'Ahmed Khan',
        customerCode: 'C-0001',
        phoneNumber: '0300-0000000',
        paymentType: 'MONTHLY',
        financialBalance: 1500,
        createdAt: '2026-01-15T00:00:00.000Z',
        deliverySchedules: [],
        route: null,
      },
    }),
    useRemovePortalAccount: () => idle,
    useCustomerConsumption: () => idle,
    useRemoveCustomPrice: () => idle,
    useCustomerSchedule: () => idle,
    useCustomerStatement: () => idle,
  };
});

// Heavy children the page renders — irrelevant to this wiring test.
jest.mock('./customer-form', () => ({ CustomerForm: () => null }));
jest.mock('./dialogs/edit-location-dialog', () => ({ EditLocationDialog: () => null }));
jest.mock('./dialogs/custom-price-dialog', () => ({ CustomPriceDialog: () => null }));
jest.mock('./dialogs/adjust-bottle-wallet-dialog', () => ({ AdjustBottleWalletDialog: () => null }));
jest.mock('./dialogs/bulk-reprice-dialog', () => ({ BulkRepriceDialog: () => null }));
jest.mock('../../../components/shared/confirm-dialog', () => ({ ConfirmDialog: () => null }));
jest.mock('../../transactions/components/transaction-list', () => ({ TransactionList: () => null }));
jest.mock('../../customer-adjustments/components/customer-adjustments-tab', () => ({
  CustomerAdjustmentsTab: ({ customerId }: { customerId: string }) => (
    <div data-testid="adjustments-tab">tab for {customerId}</div>
  ),
}));

const VIEW = 'customer_financial_adjustments:view';

describe('CustomerDetail — Charges & Credits tab wiring', () => {
  beforeEach(() => mockGranted.clear());

  it('shows the tab for a holder of customer_financial_adjustments:view, and opens it for this customer', () => {
    mockGranted.add(VIEW);
    render(<CustomerDetail customerId="cust-1" />);

    const trigger = screen.getByRole('tab', { name: 'Charges & Credits' });
    expect(screen.queryByTestId('adjustments-tab')).toBeNull(); // not the default tab; unmounted until opened
    fireEvent.mouseDown(trigger, { button: 0 }); // Radix Tabs activates on mouse-down
    expect(screen.getByTestId('adjustments-tab').textContent).toBe('tab for cust-1');
  });

  it('hides the tab AND its content entirely without the view permission', () => {
    render(<CustomerDetail customerId="cust-1" />);
    expect(screen.queryByRole('tab', { name: 'Charges & Credits' })).toBeNull();
    expect(screen.queryByTestId('adjustments-tab')).toBeNull();
  });

  it.each([
    ['create only', ['customer_financial_adjustments:create']],
    ['transfer only', ['customer_financial_adjustments:transfer']],
    ['void only', ['customer_financial_adjustments:void']],
    ['the legacy money-adjust permission', ['transactions:adjust']],
  ])('does not show the tab to someone holding %s (only `view` opens it)', (_label, perms) => {
    perms.forEach((p) => mockGranted.add(p));
    render(<CustomerDetail customerId="cust-1" />);
    expect(screen.queryByRole('tab', { name: 'Charges & Credits' })).toBeNull();
  });

  it('leaves the existing tabs exactly as they were, with or without the new one', () => {
    const existing = ['Transactions', 'Inventory & Wallets', 'Consumption', 'Schedule', 'Custom Pricing', 'Statement', 'Full Info'];

    const tabNames = () => screen.getAllByRole('tab').map((t) => t.textContent);

    const without = render(<CustomerDetail customerId="cust-1" />);
    expect(tabNames()).toEqual(existing);
    without.unmount();

    mockGranted.add(VIEW);
    render(<CustomerDetail customerId="cust-1" />);
    // same tabs in the same order, with the new one inserted just before "Full Info"
    expect(tabNames()).toEqual([...existing.slice(0, -1), 'Charges & Credits', 'Full Info']);
  });
});
