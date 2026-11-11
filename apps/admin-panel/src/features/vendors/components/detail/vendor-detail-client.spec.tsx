import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { navigationMockFactory } from '../../../../../test/mocks/next-navigation';
import { renderWithQuery } from '../../../../../test/utils/render';
import { resetMockQueryState, setMockQueryState } from '../../../../../test/mocks/nuqs';
import { VendorDetailClient } from './vendor-detail-client';
import { vendorsApi } from '../../api/vendors.api';
import { vendorDetailApi } from '../../api/vendor-detail.api';

jest.mock('next/navigation', () => navigationMockFactory());
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('nuqs', () => jest.requireActual('../../../../../test/mocks/nuqs').nuqsMockFactory());
jest.mock('../../api/vendors.api', () => ({
  vendorsApi: { getOne: jest.fn(), suspend: jest.fn(), unsuspend: jest.fn(), update: jest.fn(), remove: jest.fn() },
  vendorWipeApi: { preview: jest.fn(), wipe: jest.fn() },
  clean: (x: unknown) => x,
}));
jest.mock('../../api/vendor-detail.api', () => ({
  vendorDetailApi: {
    getStats: jest.fn(),
    getUsers: jest.fn(),
    getReadiness: jest.fn(),
    getBranding: jest.fn(),
    getAudit: jest.fn(),
    goLive: jest.fn(),
    goOffline: jest.fn(),
    provision: jest.fn(),
  },
}));

const vendors = vendorsApi as unknown as Record<string, jest.Mock>;
const detail = vendorDetailApi as unknown as Record<string, jest.Mock>;

const vendor = { id: 'v1', name: 'Aqua One', slug: 'aqua-one', isActive: true, goLiveAt: null, address: 'Main St', raastId: null, createdAt: '2026-01-01T00:00:00Z' };
const zeroStats = {
  vendor,
  stats: {
    totalCustomers: 0, totalDrivers: 0, totalRoutes: 0, totalVans: 0, totalUsers: 0, customerUsers: 0, activeUsers: 0, inactiveUsers: 0,
    totalRevenue: '0', revenueThisMonth: '1234.5', outstandingBalance: '0', deliveriesThisMonth: 0, sheetsThisMonth: 0, lastActiveDate: null,
  },
};
const item = (key: string, label: string, status: 'DONE' | 'TODO', required = true) => ({ key, label, required, status, detail: null });
const readiness = (ready: boolean, live = false) => ({
  vendor: { id: 'v1', name: 'Aqua One' },
  live,
  goLiveAt: live ? '2026-02-01T00:00:00Z' : null,
  ready,
  items: [item('company_profile', 'Company profile', ready ? 'DONE' : 'TODO'), item('products', 'Products', 'DONE'), item('whatsapp_connected', 'WhatsApp connected', 'TODO', false)],
});

beforeEach(() => {
  resetMockQueryState();
  [...Object.values(vendors), ...Object.values(detail)].forEach((m) => m.mockReset());
  vendors.getOne.mockResolvedValue(vendor);
  detail.getStats.mockResolvedValue(zeroStats);
  detail.getReadiness.mockResolvedValue(readiness(false));
  detail.getUsers.mockResolvedValue({ data: [], meta: { total: 0, page: 1, limit: 20, roleCounts: {} } });
});

describe('VendorDetailClient', () => {
  it('shows the header with name, slug and badges', async () => {
    renderWithQuery(<VendorDetailClient id="v1" />);
    expect(await screen.findByRole('heading', { name: 'Aqua One' })).toBeTruthy();
    expect(screen.getByText('aqua-one')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByText('Setup')).toBeTruthy();
    ['Overview', 'Users', 'Readiness', 'Branding', 'Activity'].forEach((t) => expect(screen.getByRole('tab', { name: t })).toBeTruthy());
  });

  it('?tab=users deep link opens the Users tab', async () => {
    setMockQueryState({ tab: 'users' });
    renderWithQuery(<VendorDetailClient id="v1" />);
    await waitFor(() => expect(detail.getUsers).toHaveBeenCalled());
    expect(screen.getByRole('tab', { name: 'Users' }).getAttribute('data-state')).toBe('active');
    expect(detail.getStats).not.toHaveBeenCalled();
  });

  it('unknown id (404) shows "Vendor not found" with a back link', async () => {
    vendors.getOne.mockRejectedValue({ response: { status: 404, data: { message: 'Vendor not found' } } });
    renderWithQuery(<VendorDetailClient id="nope" />);
    await screen.findAllByText('Vendor not found');
    expect(screen.getByText('Back to vendors').closest('a')?.getAttribute('href')).toBe('/vendors');
  });

  it('overview renders zeros as 0, null last activity as "No activity yet" and money via one helper', async () => {
    renderWithQuery(<VendorDetailClient id="v1" />);
    await screen.findByText('Customers');
    expect(screen.getByText('Customers').closest('div')?.parentElement?.querySelector('[data-stat="Customers"]')?.textContent).toBe('0');
    expect(screen.getByText('No activity yet')).toBeTruthy();
    expect(screen.getByText('Rs. 1,234.5')).toBeTruthy();
    expect(screen.getByText('Lifetime revenue').closest('div')?.parentElement?.textContent).toContain('Rs. 0');
  });

  it('overview stats error -> ErrorState with retry', async () => {
    detail.getStats.mockRejectedValueOnce({ response: { status: 500 } });
    renderWithQuery(<VendorDetailClient id="v1" />);
    await screen.findByRole('alert');
    fireEvent.click(screen.getByText('Retry'));
    await screen.findByText('Customers');
  });
});

describe('Readiness tab', () => {
  beforeEach(() => setMockQueryState({ tab: 'readiness' }));

  it('Go live is disabled when not ready; progress counts required items', async () => {
    renderWithQuery(<VendorDetailClient id="v1" />);
    await screen.findByText('1 of 2 required items done');
    expect((screen.getByRole('button', { name: 'Go live' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Force go-live')).toBeTruthy();
    expect(screen.getByText('Open Branding')).toBeTruthy(); // company_profile maps to the branding tab
    expect(screen.getByText('Vendor completes this in their dashboard')).toBeTruthy();
  });

  it('Go live is enabled when ready and sends no force flag', async () => {
    detail.getReadiness.mockResolvedValue(readiness(true));
    detail.goLive.mockResolvedValue(readiness(true, true));
    renderWithQuery(<VendorDetailClient id="v1" />);
    const btn = (await screen.findByRole('button', { name: 'Go live' })) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(screen.queryByText('Force go-live')).toBeNull();
    fireEvent.click(btn);
    await waitFor(() => expect(detail.goLive).toHaveBeenCalledWith('v1', false));
  });

  it('force go-live requires the typed slug and sends force:true', async () => {
    detail.goLive.mockResolvedValue(readiness(false, true));
    renderWithQuery(<VendorDetailClient id="v1" />);
    fireEvent.click(await screen.findByText('Force go-live'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Open items').textContent).toContain('Company profile');
    const confirm = within(dialog).getByRole('button', { name: 'Force go-live' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Type/), { target: { value: 'wrong' } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Type/), { target: { value: 'aqua-one' } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(detail.goLive).toHaveBeenCalledWith('v1', true));
  });

  it('a 409 with open[] is rendered as item labels', async () => {
    detail.getReadiness.mockResolvedValue(readiness(true));
    detail.goLive.mockRejectedValue({ response: { status: 409, data: { message: 'Finish the required checklist items before going live.', open: ['company_profile', 'products'] } } });
    renderWithQuery(<VendorDetailClient id="v1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Go live' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Finish the required checklist items');
    expect(within(alert).getByText('Company profile')).toBeTruthy();
    expect(within(alert).getByText('Products')).toBeTruthy();
  });

  it('Take offline sends the reason', async () => {
    detail.getReadiness.mockResolvedValue(readiness(true, true));
    detail.goOffline.mockResolvedValue(readiness(true, false));
    renderWithQuery(<VendorDetailClient id="v1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Take offline' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'maintenance' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Take offline' }));
    await waitFor(() => expect(detail.goOffline).toHaveBeenCalledWith('v1', 'maintenance'));
  });
});

describe('Header actions', () => {
  it('Repair setup confirms, calls provision and shows the summary', async () => {
    detail.provision.mockResolvedValue({ vendorId: 'v1', vendorName: 'Aqua One', usersBackfilled: 2, customerFlagCategoriesSeeded: 5 });
    renderWithQuery(<VendorDetailClient id="v1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Repair setup/ }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Repair setup' }));
    await waitFor(() => expect(detail.provision).toHaveBeenCalledWith('v1'));
    const summary = await screen.findByLabelText('Repair summary');
    expect(summary.textContent).toContain('Users Backfilled');
    expect(summary.textContent).toContain('5');
  });

  it('Suspend confirms then calls the API; suspended vendor shows Unsuspend', async () => {
    vendors.suspend.mockResolvedValue({});
    renderWithQuery(<VendorDetailClient id="v1" />);
    fireEvent.click(await screen.findByRole('button', { name: /^Suspend/ }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Suspend' }));
    await waitFor(() => expect(vendors.suspend).toHaveBeenCalledWith('v1'));
  });

  it('suspended vendor shows the Suspended badge and an Unsuspend button', async () => {
    vendors.getOne.mockResolvedValue({ ...vendor, isActive: false });
    renderWithQuery(<VendorDetailClient id="v1" />);
    expect(await screen.findByText('Suspended')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Unsuspend/ })).toBeTruthy();
  });
});
