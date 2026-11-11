import { screen, fireEvent, waitFor } from '@testing-library/react';
import { navigationMockFactory } from '../../../../test/mocks/next-navigation';
import { renderWithQuery } from '../../../../test/utils/render';
import { VendorList } from './vendor-list';
import { vendorsApi, vendorWipeApi } from '../api/vendors.api';
import { queryKeys } from '../../../lib/query-keys';

jest.mock('next/navigation', () => navigationMockFactory());
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('nuqs', () => ({
  useQueryState: (_k: string, parser: { defaultValue?: number }) => [parser?.defaultValue ?? 1, jest.fn()],
  parseAsInteger: { withDefault: (d: number) => ({ defaultValue: d }) },
}));
jest.mock('../api/vendors.api', () => ({
  vendorsApi: { getAll: jest.fn() },
  vendorWipeApi: { suspend: jest.fn(), unsuspend: jest.fn(), preview: jest.fn(), wipe: jest.fn() },
}));
// avoid pulling the heavy dialogs/forms into the unit under test
jest.mock('./vendor-form', () => ({ VendorForm: () => null }));
jest.mock('./wipe-vendor-dialog', () => ({ WipeVendorDialog: () => null }));

const getAll = vendorsApi.getAll as jest.Mock;

const vendor = { id: 'v1', name: 'Aqua One', slug: 'aqua-one', isActive: true, _counts: { customers: 5, drivers: 2 } };

describe('VendorList (V1)', () => {
  it('renders rows', async () => {
    getAll.mockResolvedValue({ data: { data: [vendor], meta: { total: 1 } } });
    renderWithQuery(<VendorList />);
    await screen.findByText('Aqua One');
    expect(screen.getByText('aqua-one')).toBeTruthy();
  });

  it('empty -> EmptyState with add action', async () => {
    getAll.mockResolvedValue({ data: { data: [], meta: { total: 0 } } });
    const onAdd = jest.fn();
    renderWithQuery(<VendorList onAddVendor={onAdd} />);
    await screen.findByText('No vendors yet');
    fireEvent.click(screen.getByText('Add Vendor'));
    expect(onAdd).toHaveBeenCalled();
  });

  it('error -> ErrorState and retry refetches', async () => {
    getAll.mockRejectedValueOnce({ response: { status: 500 } });
    getAll.mockResolvedValue({ data: { data: [vendor], meta: { total: 1 } } });
    renderWithQuery(<VendorList />);
    await screen.findByRole('alert');
    fireEvent.click(screen.getByText('Retry'));
    await screen.findByText('Aqua One');
  });

  it('reactivating invalidates vendors and dashboard queries', async () => {
    getAll.mockResolvedValue({ data: { data: [{ ...vendor, isActive: false }], meta: { total: 1 } } });
    (vendorWipeApi.unsuspend as jest.Mock).mockResolvedValue({});
    const { client } = renderWithQuery(<VendorList />);
    const spy = jest.spyOn(client, 'invalidateQueries');
    await screen.findByText('Aqua One');
    fireEvent.click(screen.getByLabelText('Reactivate vendor'));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.vendors.all }));
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.dashboard.all });
  });
});
