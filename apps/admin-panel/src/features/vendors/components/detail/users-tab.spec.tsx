import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithQuery } from '../../../../../test/utils/render';
import { UsersTab } from './users-tab';
import { vendorDetailApi } from '../../api/vendor-detail.api';

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('../../api/vendor-detail.api', () => ({ vendorDetailApi: { getUsers: jest.fn(), resetAdminPassword: jest.fn() } }));

const getUsers = vendorDetailApi.getUsers as jest.Mock;
const vendor = { id: 'v1', name: 'Aqua One', slug: 'aqua-one', isActive: true };

const user = (over: Record<string, unknown>) => ({ id: 'u', name: 'N', email: 'n@x.com', role: 'STAFF', roleName: 'Staff', phoneNumber: null, isActive: true, createdAt: '2026-01-01T00:00:00Z', ...over });
const reply = (rows: unknown[], roleCounts: Record<string, number> = {}) => ({ data: rows, meta: { total: rows.length, page: 1, limit: 20, roleCounts } });

const team = reply(
  [user({ id: 'a1', name: 'Ann Admin', email: 'ann@x.com', role: 'VENDOR_ADMIN', roleName: 'Vendor Admin' }), user({ id: 's1', name: 'Sam Staff', email: 'sam@x.com' })],
  { VENDOR_ADMIN: 1, STAFF: 1, DRIVER: 0, CUSTOMER: 1200 },
);

beforeEach(() => getUsers.mockReset());

describe('UsersTab', () => {
  it('hides customers by default (no role param) and shows the customer count on its chip', async () => {
    getUsers.mockResolvedValue(team);
    renderWithQuery(<UsersTab vendor={vendor as never} />);
    await screen.findByText('Ann Admin');
    expect(getUsers).toHaveBeenCalledWith('v1', { page: 1, limit: 20, role: undefined, search: undefined });
    expect(screen.getByText('Customers (1200)')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Customers (1200)' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('a role chip sets the role param and resets to page 1', async () => {
    getUsers.mockResolvedValue(team);
    renderWithQuery(<UsersTab vendor={vendor as never} />);
    await screen.findByText('Ann Admin');
    getUsers.mockResolvedValue(reply([user({ id: 'c1', name: 'Cust One', role: 'CUSTOMER', roleName: null })], { CUSTOMER: 1200 }));
    fireEvent.click(screen.getByRole('button', { name: 'Customers (1200)' }));
    await screen.findByText('Cust One');
    expect(getUsers).toHaveBeenLastCalledWith('v1', expect.objectContaining({ role: 'CUSTOMER', page: 1 }));
  });

  it('renders only one page of a huge customer list', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => user({ id: `c${i}`, name: `Cust ${i}`, role: 'CUSTOMER', roleName: null }));
    getUsers.mockResolvedValue({ data: rows, meta: { total: 1000, page: 1, limit: 20, roleCounts: { CUSTOMER: 1000 } } });
    renderWithQuery(<UsersTab vendor={vendor as never} />);
    await screen.findByText('Cust 0');
    expect(document.querySelectorAll('tbody tr')).toHaveLength(20);
  });

  it('Reset password is offered only on VENDOR_ADMIN rows and opens the dialog preselected', async () => {
    getUsers.mockResolvedValue(team);
    renderWithQuery(<UsersTab vendor={vendor as never} />);
    await screen.findByText('Ann Admin');
    const buttons = screen.getAllByRole('button', { name: /Reset password/ });
    expect(buttons).toHaveLength(1);
    expect(buttons[0].getAttribute('aria-label')).toContain('ann@x.com');
    fireEvent.click(buttons[0]);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/ann@x.com/)).toBeTruthy();
  });

  it('search is sent after the debounce', async () => {
    getUsers.mockResolvedValue(team);
    renderWithQuery(<UsersTab vendor={vendor as never} />);
    await screen.findByText('Ann Admin');
    fireEvent.change(screen.getByLabelText('Search users'), { target: { value: 'sam' } });
    await waitFor(() => expect(getUsers).toHaveBeenLastCalledWith('v1', expect.objectContaining({ search: 'sam' })));
  });
});
