import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import { navigationMockFactory } from '../../../../test/mocks/next-navigation';
import { renderWithQuery } from '../../../../test/utils/render';
import { resetMockQueryState, setMockQueryState } from '../../../../test/mocks/nuqs';
import { VendorList } from './vendor-list';
import { vendorsApi } from '../api/vendors.api';
import { queryKeys } from '../../../lib/query-keys';

jest.mock('next/navigation', () => navigationMockFactory());
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('nuqs', () => jest.requireActual('../../../../test/mocks/nuqs').nuqsMockFactory());
jest.mock('../api/vendors.api', () => ({
  vendorsApi: { getAll: jest.fn(), suspend: jest.fn(), unsuspend: jest.fn(), bulkSuspend: jest.fn(), bulkUnsuspend: jest.fn(), remove: jest.fn() },
  vendorWipeApi: { preview: jest.fn(), wipe: jest.fn() },
}));
// the heavy dialogs are covered by their own specs
jest.mock('./vendor-form', () => ({ VendorForm: () => null }));
jest.mock('./wipe-vendor-dialog', () => ({ WipeVendorDialog: () => null }));

const api = vendorsApi as unknown as Record<string, jest.Mock>;
const page = (rows: unknown[], total = rows.length) => ({ data: rows, meta: { total, page: 1, limit: 20 } });

const aqua = { id: 'v1', name: 'Aqua One', slug: 'aqua-one', isActive: true, goLiveAt: '2026-01-01T00:00:00Z', adminEmail: 'a@aqua.com', _counts: { customers: 5, drivers: 2 } };
const blue = { id: 'v2', name: 'Blue Co', slug: 'blue-co', isActive: false, goLiveAt: null, adminEmail: null, _counts: { customers: 0, drivers: 0 } };
const green = { id: 'v3', name: 'Green Co', slug: 'green-co', isActive: true, goLiveAt: null, adminEmail: 'g@green.com', _counts: { customers: 1, drivers: 1 } };

beforeEach(() => {
  resetMockQueryState();
  Object.values(api).forEach((m) => m.mockReset());
});

describe('VendorList', () => {
  it('renders rows with active/suspended and live/setup badges and an admin email', async () => {
    api.getAll.mockResolvedValue(page([aqua, blue]));
    renderWithQuery(<VendorList />);
    await screen.findByText('Aqua One');
    expect(screen.getByText('a@aqua.com')).toBeTruthy();
    expect(screen.getAllByText('Active', { selector: 'div' })).toHaveLength(1);
    expect(screen.getAllByText('Suspended', { selector: 'div' })).toHaveLength(1);
    expect(screen.getAllByText('Live', { selector: 'div' })).toHaveLength(1);
    expect(screen.getAllByText('Setup', { selector: 'div' })).toHaveLength(1);
  });

  it('vendor name links to the detail page', async () => {
    api.getAll.mockResolvedValue(page([aqua]));
    renderWithQuery(<VendorList />);
    const link = (await screen.findByText('Aqua One')).closest('a');
    expect(link?.getAttribute('href')).toBe('/vendors/v1');
  });

  it('first request carries the default sort and no empty filters', async () => {
    api.getAll.mockResolvedValue(page([aqua]));
    renderWithQuery(<VendorList />);
    await screen.findByText('Aqua One');
    expect(api.getAll).toHaveBeenCalledWith({ page: 1, limit: 20, search: '', status: 'all', sort: 'createdAt', order: 'desc' });
  });

  it('debounces search (300ms) and sends it as `search`', async () => {
    jest.useFakeTimers();
    try {
      api.getAll.mockResolvedValue(page([aqua]));
      renderWithQuery(<VendorList />);
      await act(async () => {
        await Promise.resolve();
      });
      api.getAll.mockClear();
      fireEvent.change(screen.getByLabelText('Search vendors'), { target: { value: 'aq' } });
      fireEvent.change(screen.getByLabelText('Search vendors'), { target: { value: 'aqu' } });
      await act(async () => {
        jest.advanceTimersByTime(250);
      });
      expect(api.getAll).not.toHaveBeenCalled();
      await act(async () => {
        jest.advanceTimersByTime(100);
      });
      await waitFor(() => expect(api.getAll).toHaveBeenCalledTimes(1));
      expect(api.getAll.mock.calls[0][0]).toMatchObject({ search: 'aqu', page: 1 });
    } finally {
      jest.useRealTimers();
    }
  });

  it('status filter sends `status`', async () => {
    api.getAll.mockResolvedValue(page([blue]));
    renderWithQuery(<VendorList />);
    await screen.findByText('Blue Co');
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'suspended' } });
    await waitFor(() => expect(api.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'suspended', page: 1 })));
  });

  it('sort header toggles the order', async () => {
    api.getAll.mockResolvedValue(page([aqua]));
    renderWithQuery(<VendorList />);
    await screen.findByText('Aqua One');
    fireEvent.click(screen.getByLabelText('Sort by vendor'));
    await waitFor(() => expect(api.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'name', order: 'asc' })));
    fireEvent.click(screen.getByLabelText('Sort by vendor'));
    await waitFor(() => expect(api.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'name', order: 'desc' })));
  });

  it('no vendors at all -> "No vendors yet" with add action', async () => {
    api.getAll.mockResolvedValue(page([]));
    const onAdd = jest.fn();
    renderWithQuery(<VendorList onAddVendor={onAdd} />);
    await screen.findByText('No vendors yet');
    fireEvent.click(screen.getByText('Add Vendor'));
    expect(onAdd).toHaveBeenCalled();
  });

  it('filters with no results -> "no match" empty state with clear-filters', async () => {
    setMockQueryState({ q: 'zzz' });
    api.getAll.mockResolvedValue(page([]));
    renderWithQuery(<VendorList />);
    await screen.findByText('No vendors match your filters');
    expect(screen.queryByText('No vendors yet')).toBeNull();
    api.getAll.mockResolvedValue(page([aqua]));
    fireEvent.click(screen.getByText('Clear filters'));
    await screen.findByText('Aqua One');
  });

  it('error -> ErrorState and retry refetches', async () => {
    api.getAll.mockRejectedValueOnce({ response: { status: 500 } });
    api.getAll.mockResolvedValue(page([aqua]));
    renderWithQuery(<VendorList />);
    await screen.findByRole('alert');
    fireEvent.click(screen.getByText('Retry'));
    await screen.findByText('Aqua One');
  });

  it('reactivating invalidates vendors and dashboard queries', async () => {
    api.getAll.mockResolvedValue(page([blue]));
    api.unsuspend.mockResolvedValue({});
    const { client } = renderWithQuery(<VendorList />);
    const spy = jest.spyOn(client, 'invalidateQueries');
    await screen.findByText('Blue Co');
    fireEvent.click(screen.getByLabelText('Reactivate vendor'));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.vendors.all }));
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.dashboard.all });
  });
});

describe('VendorList bulk actions', () => {
  const setup = async () => {
    api.getAll.mockResolvedValue(page([aqua, blue, green]));
    renderWithQuery(<VendorList />);
    await screen.findByText('Aqua One');
  };

  it('no bulk bar until something is selected; bar offers only Suspend and Reactivate', async () => {
    await setup();
    expect(screen.queryByRole('toolbar')).toBeNull();
    fireEvent.click(screen.getByLabelText('Select Aqua One'));
    const bar = screen.getByRole('toolbar', { name: 'Bulk actions' });
    const labels = Array.from(bar.querySelectorAll('button')).map((b) => b.textContent?.trim());
    expect(labels).toEqual(['Suspend', 'Reactivate', 'Clear']);
    expect(bar.textContent).not.toMatch(/delete|wipe|reset/i);
  });

  it('requires the typed phrase, sends one bulk call and shows per-vendor results', async () => {
    await setup();
    api.bulkSuspend.mockResolvedValue({
      results: [
        { id: 'v1', ok: true },
        { id: 'v3', ok: false, error: 'Vendor is already suspended' },
      ],
      succeeded: 1,
      failed: 1,
    });
    fireEvent.click(screen.getByLabelText('Select Aqua One'));
    fireEvent.click(screen.getByLabelText('Select Green Co'));
    fireEvent.click(within(screen.getByRole('toolbar')).getByText('Suspend'));

    const confirm = await screen.findByRole('button', { name: 'Suspend' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Type/), { target: { value: 'SUSPEND 1' } });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Type/), { target: { value: 'SUSPEND 2' } });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'non payment' } });
    fireEvent.click(confirm);

    await waitFor(() => expect(api.bulkSuspend).toHaveBeenCalledTimes(1));
    expect(api.bulkSuspend).toHaveBeenCalledWith(['v1', 'v3'], 'non payment');
    const results = await screen.findByLabelText('Bulk results');
    expect(within(results).getByText('Vendor is already suspended')).toBeTruthy();
    expect(results.querySelectorAll('[data-result="failed"]')).toHaveLength(1);
    expect(results.querySelectorAll('[data-result="ok"]')).toHaveLength(1);
  });

  it('lists at most 10 names plus "and N more"', async () => {
    const many = Array.from({ length: 13 }, (_, i) => ({ ...green, id: `x${i}`, name: `Vendor ${i}`, slug: `v-${i}` }));
    api.getAll.mockResolvedValue(page(many));
    renderWithQuery(<VendorList />);
    await screen.findByText('Vendor 0');
    fireEvent.click(screen.getByLabelText('Select all vendors on this page'));
    fireEvent.click(within(screen.getByRole('toolbar')).getByText('Suspend'));
    const list = await screen.findByLabelText('Selected vendors');
    expect(list.querySelectorAll('li')).toHaveLength(11);
    expect(within(list).getByText('and 3 more')).toBeTruthy();
  });

  it('selection clears when a filter changes', async () => {
    await setup();
    fireEvent.click(screen.getByLabelText('Select Aqua One'));
    expect(screen.getByRole('toolbar')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'active' } });
    await waitFor(() => expect(screen.queryByRole('toolbar')).toBeNull());
  });
});

import { within } from '@testing-library/react';
