import { screen, waitFor, fireEvent } from '@testing-library/react';
import { apiClient } from '@water-supply-crm/data-access';
import { PlatformOverviewView } from './platform-overview';
import { renderWithQuery, fullPlatformPayload } from '../../../../test/utils/render';

jest.mock('@water-supply-crm/data-access', () => ({ apiClient: { get: jest.fn() } }));
const get = apiClient.get as jest.Mock;

const ok = (data: unknown) => get.mockResolvedValue({ data });
const kpi = (id: string) => screen.getByTestId(`kpi-${id}`).textContent ?? '';

describe('PlatformOverviewView', () => {
  it('renders every field of the payload and only calls /dashboard/platform', async () => {
    ok(fullPlatformPayload);
    renderWithQuery(<PlatformOverviewView />);
    await screen.findByTestId('kpi-vendors-total');

    expect(kpi('vendors-total')).toContain('12');
    expect(kpi('vendors-total')).toContain('+2 this month');
    expect(kpi('vendors-active')).toContain('9');
    expect(kpi('vendors-suspended')).toContain('3');
    expect(kpi('customers')).toContain('1,500');
    expect(kpi('drivers')).toContain('40');
    expect(kpi('revenue-month')).toContain('Rs. 120,000');
    expect(kpi('revenue-month')).toContain('Last month Rs. 100,000');
    expect(kpi('revenue-month')).toContain('+20%');
    expect(kpi('revenue-all')).toContain('Rs. 9,876,543');
    expect(kpi('deliveries')).toContain('777');

    const items = screen.getByTestId('top-vendors').querySelectorAll('li');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('Aqua One');
    expect(items[0].textContent).toContain('aqua-one');
    expect(items[0].textContent).toContain('Rs. 50,000');
    expect(items[1].textContent).toContain('Blue Co');

    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls.map((c) => c[0])).toEqual(['/dashboard/platform']);
  });

  it('shows growth badge for negative and zero growth', async () => {
    ok({ ...fullPlatformPayload, revenue: { ...fullPlatformPayload.revenue, growthPercent: -5 } });
    const { unmount } = renderWithQuery(<PlatformOverviewView />);
    await screen.findByTestId('growth-badge');
    expect(screen.getByTestId('growth-badge').textContent).toBe('-5%');
    unmount();

    ok({ ...fullPlatformPayload, revenue: { ...fullPlatformPayload.revenue, growthPercent: 0 } });
    renderWithQuery(<PlatformOverviewView />);
    await waitFor(() => expect(screen.getByTestId('growth-badge').textContent).toBe('0%'));
  });

  it('shows skeleton while loading', () => {
    get.mockReturnValue(new Promise(() => undefined));
    renderWithQuery(<PlatformOverviewView />);
    expect(screen.getByTestId('overview-skeleton')).toBeTruthy();
  });

  it('shows ErrorState on failure and Retry refetches', async () => {
    get.mockRejectedValueOnce({ response: { status: 500 } });
    ok(fullPlatformPayload);
    renderWithQuery(<PlatformOverviewView />);
    await screen.findByRole('alert');
    fireEvent.click(screen.getByText('Retry'));
    await screen.findByTestId('kpi-vendors-total');
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('empty topVendors shows empty state', async () => {
    ok({ ...fullPlatformPayload, topVendors: [] });
    renderWithQuery(<PlatformOverviewView />);
    await screen.findByText('No revenue yet');
  });

  it('falls back to vendor id when name is missing', async () => {
    ok({ ...fullPlatformPayload, topVendors: [{ vendor: { id: 'only-id' }, totalRevenue: 10 }] });
    renderWithQuery(<PlatformOverviewView />);
    await screen.findByText('only-id');
  });

  it('renders 0 not NaN/undefined for missing numerics', async () => {
    ok({
      vendors: {},
      customers: {},
      drivers: {},
      revenue: {},
      deliveries: {},
      topVendors: [],
    });
    renderWithQuery(<PlatformOverviewView />);
    await screen.findByTestId('kpi-customers');
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/NaN|undefined/);
    expect(kpi('revenue-all')).toContain('Rs. 0');
    expect(kpi('customers')).toContain('0');
  });
});
