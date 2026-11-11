import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { toast } from 'sonner';
import { navigationMockFactory, setMockNavigation } from '../../../../test/mocks/next-navigation';
import { renderWithQuery } from '../../../../test/utils/render';
import { PlatformAdminsPageClient } from './platform-admins-page-client';
import { platformAdminsApi, type PlatformAdminRow } from '../api/platform-admins.api';
import { useAuthStore } from '../../../store/auth.store';
import { createAdminSchema } from './create-admin-dialog';

jest.mock('next/navigation', () => navigationMockFactory());
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn(), warning: jest.fn() } }));
jest.mock('../api/platform-admins.api', () => ({
  platformAdminsApi: {
    list: jest.fn(),
    create: jest.fn(),
    deactivate: jest.fn(),
    activate: jest.fn(),
    resetPassword: jest.fn(),
    resetTwoFactor: jest.fn(),
    unlock: jest.fn(),
  },
}));

const api = platformAdminsApi as jest.Mocked<typeof platformAdminsApi>;

const row = (over: Partial<PlatformAdminRow>): PlatformAdminRow => ({
  id: 'a1',
  name: 'Root Admin',
  email: 'root@x.com',
  isActive: true,
  lastLoginAt: null,
  mustChangePassword: false,
  createdAt: '2026-01-01T00:00:00Z',
  twoFactorEnabled: true,
  activeSessions: 2,
  ...over,
});
const two = [row({ id: 'a1' }), row({ id: 'a2', name: 'Second', email: 'second@x.com', twoFactorEnabled: false })];
const list = (rows: PlatformAdminRow[]) => ({ data: rows, meta: { total: rows.length, page: 1, limit: 20, totalPages: 1 } });

beforeEach(() => {
  setMockNavigation('/settings/admins');
  useAuthStore.setState({ user: { id: 'a1', name: 'Root Admin', email: 'root@x.com', role: 'SUPER_ADMIN' } });
  api.list.mockResolvedValue(list(two));
});

describe('PlatformAdminsPageClient', () => {
  it('renders rows with status and 2FA badges, marks the current user', async () => {
    renderWithQuery(<PlatformAdminsPageClient />);
    await screen.findByText('Second');
    expect(screen.getByText('(you)')).toBeTruthy();
    expect(screen.getAllByTestId('admin-2fa-badge').map((b) => b.textContent)).toEqual(['2FA on', '2FA off']);
  });

  it('Deactivate is disabled for the own row with an explanation', async () => {
    renderWithQuery(<PlatformAdminsPageClient />);
    await screen.findByText('Second');
    const own = screen.getByLabelText('Deactivate root@x.com') as HTMLButtonElement;
    expect(own.disabled).toBe(true);
    expect(own.title).toMatch(/your own account/i);
    expect((screen.getByLabelText('Deactivate second@x.com') as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByLabelText('Reset 2FA root@x.com') as HTMLButtonElement).disabled).toBe(true);
  });

  it('the only active admin cannot be deactivated (tooltip), even from another account view', async () => {
    useAuthStore.setState({ user: { id: 'zzz', name: 'x', email: 'x', role: 'SUPER_ADMIN' } });
    api.list.mockResolvedValue(list([row({ id: 'a1' }), row({ id: 'a2', email: 'second@x.com', isActive: false })]));
    renderWithQuery(<PlatformAdminsPageClient />);
    await screen.findByText('second@x.com');
    const last = screen.getByLabelText('Deactivate root@x.com') as HTMLButtonElement;
    expect(last.disabled).toBe(true);
    expect(last.title).toMatch(/last active administrator/i);
    expect(screen.getByLabelText('Activate second@x.com')).toBeTruthy();
  });

  it('deactivate requires a reason, sends it, and a 409 LAST_ADMIN shows the server message', async () => {
    api.deactivate.mockRejectedValue({
      response: { status: 409, data: { code: 'LAST_ADMIN', message: 'Cannot deactivate the last active platform administrator' } },
    });
    renderWithQuery(<PlatformAdminsPageClient />);
    await screen.findByText('Second');
    fireEvent.click(screen.getByLabelText('Deactivate second@x.com'));
    const confirm = screen.getByRole('button', { name: 'Deactivate' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'left the company' } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(api.deactivate).toHaveBeenCalledWith('a2', 'left the company'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Cannot deactivate the last active platform administrator'));
  });

  it('reset 2FA requires a reason', async () => {
    api.resetTwoFactor.mockResolvedValue({ id: 'a2', message: 'ok' });
    renderWithQuery(<PlatformAdminsPageClient />);
    await screen.findByText('Second');
    fireEvent.click(screen.getByLabelText('Reset 2FA second@x.com'));
    expect((screen.getByRole('button', { name: 'Reset 2FA' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'lost phone' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset 2FA' }));
    await waitFor(() => expect(api.resetTwoFactor).toHaveBeenCalledWith('a2', 'lost phone'));
  });

  it('create: validates, shows the temporary password once, and clears it on close', async () => {
    api.create.mockResolvedValue({ id: 'n1', email: 'new@x.com', name: 'New One', mustChangePassword: true, tempPassword: 'Tmp#Pass12345' });
    renderWithQuery(<PlatformAdminsPageClient />);
    await screen.findByText('Second');
    fireEvent.click(screen.getByRole('button', { name: /Add administrator/ }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'N' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'bad' } });
    fireEvent.change(screen.getByLabelText('Password (optional)'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create administrator' }));
    await screen.findByText('Name must be at least 2 characters');
    expect(screen.getByText('Enter a valid email address')).toBeTruthy();
    expect(screen.getByText('Password must be at least 12 characters')).toBeTruthy();
    expect(api.create).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New One' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@x.com' } });
    fireEvent.change(screen.getByLabelText('Password (optional)'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create administrator' }));
    const pw = await screen.findByTestId('temp-password');
    expect(pw.textContent).toBe('Tmp#Pass12345');
    expect(api.create).toHaveBeenCalledWith({ name: 'New One', email: 'new@x.com' });

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByTestId('temp-password')).toBeNull());
  });

  it('reset password TEMP reveals the new password once; EMAIL just toasts', async () => {
    api.resetPassword.mockResolvedValueOnce({ id: 'a2', tempPassword: 'Reset#Pass9999' }).mockResolvedValueOnce({ id: 'a2', message: 'sent' });
    renderWithQuery(<PlatformAdminsPageClient />);
    await screen.findByText('Second');
    fireEvent.click(screen.getByLabelText('Reset password second@x.com'));
    fireEvent.click(screen.getByRole('button', { name: 'Generate temporary password' }));
    expect((await screen.findByTestId('temp-password')).textContent).toBe('Reset#Pass9999');
    expect(api.resetPassword).toHaveBeenCalledWith('a2', 'TEMP');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    fireEvent.click(screen.getByLabelText('Reset password second@x.com'));
    fireEvent.click(screen.getByRole('button', { name: 'Email reset link' }));
    await waitFor(() => expect(api.resetPassword).toHaveBeenCalledWith('a2', 'EMAIL'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Password reset email sent'));
  });

  it('unlock and activate call the API', async () => {
    api.list.mockResolvedValue(list([row({ id: 'a1' }), row({ id: 'a2', email: 'second@x.com', isActive: false })]));
    api.unlock.mockResolvedValue({ id: 'a2', message: 'ok' });
    api.activate.mockResolvedValue({ id: 'a2', isActive: true });
    renderWithQuery(<PlatformAdminsPageClient />);
    await screen.findByText('second@x.com');
    fireEvent.click(screen.getByLabelText('Unlock second@x.com'));
    await waitFor(() => expect(api.unlock).toHaveBeenCalledWith('a2'));
    fireEvent.click(screen.getByLabelText('Activate second@x.com'));
    await waitFor(() => expect(api.activate).toHaveBeenCalledWith('a2'));
  });

  it('shows an error state with retry when the list fails', async () => {
    api.list.mockRejectedValue({ response: { status: 500, data: { message: 'boom' } } });
    renderWithQuery(<PlatformAdminsPageClient />);
    await screen.findByText('boom');
    api.list.mockResolvedValue(list(two));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Second');
  });
});

describe('createAdminSchema', () => {
  it('accepts an empty password (temp is generated) and rejects < 12 chars', () => {
    expect(createAdminSchema.safeParse({ name: 'Ab', email: 'a@b.co' }).success).toBe(true);
    expect(createAdminSchema.safeParse({ name: 'Ab', email: 'a@b.co', password: '' }).success).toBe(true);
    expect(createAdminSchema.safeParse({ name: 'Ab', email: 'a@b.co', password: '12345678901' }).success).toBe(false);
    expect(createAdminSchema.safeParse({ name: 'Ab', email: 'a@b.co', password: '123456789012' }).success).toBe(true);
  });
});
