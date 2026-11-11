import { fireEvent, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { navigationMockFactory, routerMock, setMockNavigation } from '../../../../test/mocks/next-navigation';
import { renderWithQuery } from '../../../../test/utils/render';
import { SecurityPageClient } from './security-page-client';
import { describeAgent } from './sessions-card';
import { securityApi, type AdminSession } from '../api/security.api';

jest.mock('next/navigation', () => navigationMockFactory());
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn(), warning: jest.fn() } }));
jest.mock('../../auth/api/auth.api', () => ({
  authApi: { logout: jest.fn(async () => ({ message: 'ok' })) },
}));
jest.mock('../api/security.api', () => ({
  securityApi: {
    twoFactorStatus: jest.fn(),
    setup: jest.fn(),
    confirm: jest.fn(),
    regenerate: jest.fn(),
    disable: jest.fn(),
    sessions: jest.fn(),
    revokeSession: jest.fn(),
    revokeOthers: jest.fn(),
  },
}));

const api = securityApi as jest.Mocked<typeof securityApi>;
const session = (over: Partial<AdminSession>): AdminSession => ({
  id: 's1',
  ip: '10.0.0.1',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36',
  createdAt: '2026-01-01T00:00:00Z',
  lastSeenAt: '2026-01-02T00:00:00Z',
  expiresAt: '2026-02-01T00:00:00Z',
  current: false,
  ...over,
});
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  setMockNavigation('/settings/security');
  api.twoFactorStatus.mockResolvedValue({ enabled: false, enabledAt: null, recoveryCodesRemaining: 0 });
  api.sessions.mockResolvedValue([session({ id: 'cur', current: true }), session({ id: 'other', ip: '10.0.0.2' })]);
});

describe('sessions', () => {
  it('lists sessions and marks the current one', async () => {
    renderWithQuery(<SecurityPageClient />);
    await screen.findByText('10.0.0.2');
    expect(screen.getAllByTestId('current-session')).toHaveLength(1);
    expect(screen.getAllByText('Chrome on Windows')).toHaveLength(2);
  });

  it('revoke asks for confirmation, calls DELETE and refetches', async () => {
    api.revokeSession.mockResolvedValue({ message: 'ok' });
    renderWithQuery(<SecurityPageClient />);
    await screen.findByText('10.0.0.2');
    fireEvent.click(screen.getByLabelText('Revoke session other'));
    expect(api.revokeSession).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(api.revokeSession).toHaveBeenCalledWith('other'));
    await waitFor(() => expect(api.sessions).toHaveBeenCalledTimes(2));
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it('revoking the current session signs this browser out', async () => {
    api.revokeSession.mockResolvedValue({ message: 'ok' });
    renderWithQuery(<SecurityPageClient />);
    await screen.findByText('10.0.0.2');
    fireEvent.click(screen.getByLabelText('Revoke session cur'));
    expect(screen.getByText(/signs you out/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/auth/login'));
  });

  it('revoke all others', async () => {
    api.revokeOthers.mockResolvedValue({ revoked: 3 });
    renderWithQuery(<SecurityPageClient />);
    await screen.findByText('10.0.0.2');
    fireEvent.click(screen.getByRole('button', { name: 'Revoke all others' }));
    await waitFor(() => expect(api.revokeOthers).toHaveBeenCalled());
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Revoked 3 other sessions'));
  });

  it('revoke all others is disabled when only the current session exists', async () => {
    api.sessions.mockResolvedValue([session({ id: 'cur', current: true })]);
    renderWithQuery(<SecurityPageClient />);
    await screen.findByTestId('current-session');
    expect((screen.getByRole('button', { name: 'Revoke all others' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('describeAgent is readable and tolerant', () => {
    expect(describeAgent(null)).toBe('Unknown device');
    expect(describeAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X) Firefox/120')).toBe('Firefox on macOS');
    expect(describeAgent('curl/8')).toBe('Browser');
  });
});

describe('two-factor card', () => {
  it('enable: QR, 6-digit validation, confirm, recovery codes once, status refreshes', async () => {
    api.setup.mockResolvedValue({ otpauthUri: 'otpauth://x', qrDataUrl: 'data:image/png;base64,AAAA', secret: 'SECRETB32' });
    api.confirm.mockResolvedValue({ recoveryCodes: ['AAAAA-AAAAA', 'BBBBB-BBBBB'] });
    const { container } = renderWithQuery(<SecurityPageClient />);
    await screen.findByText('Disabled');
    fireEvent.click(screen.getByRole('button', { name: 'Enable two-factor authentication' }));
    await waitFor(() => expect(container.ownerDocument.querySelector('img[src^="data:image/png"]')).not.toBeNull());

    const confirm = screen.getByRole('button', { name: 'Confirm and enable' }) as HTMLButtonElement;
    type('Authentication code', '12');
    expect(screen.getByText('Enter the 6-digit code')).toBeTruthy();
    expect(confirm.disabled).toBe(true);
    api.twoFactorStatus.mockResolvedValue({ enabled: true, enabledAt: '2026-01-01T00:00:00Z', recoveryCodesRemaining: 2 });
    type('Authentication code', '123456');
    fireEvent.click(confirm);
    await screen.findByTestId('recovery-codes-panel');
    expect(api.confirm).toHaveBeenCalledWith('123456');
    expect((screen.getByRole('button', { name: 'Done' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('I saved them'));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.getByTestId('two-factor-status').textContent).toBe('Enabled'));
    expect(screen.queryByTestId('recovery-codes-panel')).toBeNull();
  });

  it('enabled: regenerate needs a fresh code and shows the new codes', async () => {
    api.twoFactorStatus.mockResolvedValue({ enabled: true, enabledAt: '2026-01-01T00:00:00Z', recoveryCodesRemaining: 4 });
    api.regenerate.mockResolvedValue({ recoveryCodes: ['CCCCC-CCCCC'] });
    renderWithQuery(<SecurityPageClient />);
    await screen.findByText('Enabled');
    expect(screen.getByText(/4 recovery code\(s\) remaining/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate recovery codes' }));
    type('Authentication code', '654321');
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    await screen.findByText('CCCCC-CCCCC');
    expect(api.regenerate).toHaveBeenCalledWith('654321');
  });

  it('disable needs password and a 6-digit code; a 409 2FA_REQUIRED surfaces the server message', async () => {
    api.twoFactorStatus.mockResolvedValue({ enabled: true, enabledAt: '2026-01-01T00:00:00Z', recoveryCodesRemaining: 4 });
    api.disable.mockRejectedValue({ response: { status: 409, data: { message: '2FA is required for platform administrators' } } });
    renderWithQuery(<SecurityPageClient />);
    await screen.findByText('Enabled');
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    const submit = screen.getAllByRole('button', { name: 'Disable' }).pop() as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    type('Password', 'pw');
    type('Authentication code', '111111');
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(api.disable).toHaveBeenCalledWith('pw', '111111'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('2FA is required for platform administrators'));
  });

  it('shows an error state when status fails to load', async () => {
    api.twoFactorStatus.mockRejectedValue({ response: { status: 500, data: { message: 'nope' } } });
    renderWithQuery(<SecurityPageClient />);
    await screen.findByText('nope');
  });
});
