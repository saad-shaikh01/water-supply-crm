import { fireEvent, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { navigationMockFactory, routerMock, setMockNavigation } from '../../../../test/mocks/next-navigation';
import { renderWithQuery } from '../../../../test/utils/render';
import { LoginForm } from './login-form';
import { authApi } from '../api/auth.api';
import { cookieOptions } from '../hooks/use-auth';
import { useAuthStore } from '../../../store/auth.store';

jest.mock('next/navigation', () => navigationMockFactory());
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn(), warning: jest.fn() } }));
jest.mock('../api/auth.api', () => ({
  ...jest.requireActual('../api/auth.api'),
  authApi: {
    login: jest.fn(),
    verifyTwoFactor: jest.fn(),
    enrollStart: jest.fn(),
    enrollConfirm: jest.fn(),
    changeOwnPassword: jest.fn(),
    logout: jest.fn(),
    me: jest.fn(),
    forgotPassword: jest.fn(),
    resetPassword: jest.fn(),
  },
}));

const api = authApi as jest.Mocked<typeof authApi>;
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const tokens = (extra: Record<string, unknown> = {}, userExtra: Record<string, unknown> = {}) => ({
  access_token: 'AT',
  refresh_token: 'RT',
  user: { id: 'u1', name: 'N', email: 'e@x.com', role: 'SUPER_ADMIN', ...userExtra },
  ...extra,
});
const cookieNames = () =>
  document.cookie
    .split(';')
    .map((c) => c.trim().split('=')[0])
    .filter(Boolean);

async function signIn() {
  type('Email', 'root@x.com');
  type('Password', 'secret123');
  fireEvent.click(screen.getByRole('button', { name: 'Login' }));
}

beforeEach(() => {
  setMockNavigation('/auth/login');
  cookieNames().forEach((n) => (document.cookie = `${n}=; max-age=0; path=/`));
  useAuthStore.setState({ user: null });
});

describe('cookie flags', () => {
  it('uses sameSite strict and path /; secure in production builds', () => {
    expect(cookieOptions()).toMatchObject({ sameSite: 'strict', path: '/' });
    const env = process.env as Record<string, string | undefined>;
    const prev = env['NODE_ENV'];
    env['NODE_ENV'] = 'production';
    expect(cookieOptions().secure).toBe(true);
    env['NODE_ENV'] = prev;
  });
});

describe('login: 2FA challenge step', () => {
  beforeEach(() => api.login.mockResolvedValue({ requires2fa: true, challengeToken: 'CH' }));

  it('shows the code step without storing any session', async () => {
    renderWithQuery(<LoginForm />);
    await signIn();
    await screen.findByLabelText('Authentication code');
    expect(cookieNames()).toEqual([]);
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it('a wrong code shows the error and stays on the step', async () => {
    api.verifyTwoFactor.mockRejectedValue({ response: { status: 401, data: { message: 'Invalid verification code' } } });
    renderWithQuery(<LoginForm />);
    await signIn();
    await screen.findByLabelText('Authentication code');
    type('Authentication code', '000000');
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Invalid verification code'));
    expect(screen.getByLabelText('Authentication code')).toBeTruthy();
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it('rejects a non 6-digit code client-side', async () => {
    renderWithQuery(<LoginForm />);
    await signIn();
    await screen.findByLabelText('Authentication code');
    type('Authentication code', '12');
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await screen.findByText('Enter the 6-digit code');
    expect(api.verifyTwoFactor).not.toHaveBeenCalled();
  });

  it('a valid TOTP sets the session cookies and goes home', async () => {
    api.verifyTwoFactor.mockResolvedValue(tokens());
    renderWithQuery(<LoginForm />);
    await signIn();
    await screen.findByLabelText('Authentication code');
    type('Authentication code', '123456');
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/'));
    expect(api.verifyTwoFactor).toHaveBeenCalledWith({ challengeToken: 'CH', code: '123456' });
    expect(cookieNames()).toEqual(expect.arrayContaining(['auth_token', 'refresh_token', 'user_role']));
  });

  it('the recovery toggle submits recoveryCode instead and warns about remaining codes', async () => {
    api.verifyTwoFactor.mockResolvedValue(tokens({ usedRecoveryCode: true, remainingRecoveryCodes: 9 }));
    renderWithQuery(<LoginForm />);
    await signIn();
    await screen.findByLabelText('Authentication code');
    fireEvent.click(screen.getByText('Use a recovery code instead'));
    type('Recovery code', 'ABCDE-FGHJK');
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(api.verifyTwoFactor).toHaveBeenCalledWith({ challengeToken: 'CH', recoveryCode: 'ABCDE-FGHJK' }));
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('9 remaining')));
  });
});

describe('login: forced enrollment step', () => {
  beforeEach(() => {
    api.login.mockResolvedValue({ requires2faEnrollment: true, enrollmentToken: 'EN' });
    api.enrollStart.mockResolvedValue({ otpauthUri: 'otpauth://x', qrDataUrl: 'data:image/png;base64,AAAA', secret: 'JBSWY3DPEHPK3PXP' });
  });

  it('QR -> confirm -> recovery codes; Continue is gated by the checkbox', async () => {
    const codes = ['AAAAA-AAAAA', 'BBBBB-BBBBB'];
    api.enrollConfirm.mockResolvedValue(tokens({ recoveryCodes: codes }));
    const { container } = renderWithQuery(<LoginForm />);
    await signIn();
    await waitFor(() => expect(container.querySelector('img[src^="data:image/png"]')).not.toBeNull());
    expect(screen.getByTestId('totp-secret').textContent).toBe('JBSWY3DPEHPK3PXP');
    expect(api.enrollStart).toHaveBeenCalledWith('EN');

    type('Authentication code', '123456');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and enable' }));
    await screen.findByTestId('recovery-codes-panel');
    expect(screen.getAllByTestId('recovery-code').map((e) => e.textContent)).toEqual(codes);
    expect(api.enrollConfirm).toHaveBeenCalledWith('EN', '123456');

    const cont = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;
    expect(cont.disabled).toBe(true);
    expect(routerMock.replace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('I saved them'));
    expect(cont.disabled).toBe(false);
    fireEvent.click(cont);
    expect(routerMock.replace).toHaveBeenCalledWith('/');
  });
});

describe('login: guards and mustChangePassword', () => {
  it('a non-SUPER_ADMIN is rejected without cookies or navigation', async () => {
    api.login.mockResolvedValue(tokens({}, { role: 'VENDOR_ADMIN' }));
    api.logout.mockResolvedValue({ message: 'ok' });
    renderWithQuery(<LoginForm />);
    await signIn();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('platform administrators only')));
    expect(cookieNames()).toEqual([]);
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it('mustChangePassword shows the change-password step instead of navigating; submitting goes home', async () => {
    api.login.mockResolvedValue(tokens({}, { mustChangePassword: true }));
    api.changeOwnPassword.mockResolvedValue({});
    renderWithQuery(<LoginForm />);
    await signIn();
    await screen.findByTestId('change-password-step');
    expect(routerMock.replace).not.toHaveBeenCalled();

    type('Temporary password', 'secret123');
    type('New password', 'a-very-long-pass-1');
    type('Confirm new password', 'a-very-long-pass-1');
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    await waitFor(() => expect(api.changeOwnPassword).toHaveBeenCalledWith('secret123', 'a-very-long-pass-1'));
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/'));
  });

  it('change-password validates length and confirmation', async () => {
    api.login.mockResolvedValue(tokens({}, { mustChangePassword: true }));
    renderWithQuery(<LoginForm />);
    await signIn();
    await screen.findByTestId('change-password-step');
    type('Temporary password', 'x');
    type('New password', 'short');
    type('Confirm new password', 'other');
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    await screen.findByText('New password must be at least 12 characters');
    expect(api.changeOwnPassword).not.toHaveBeenCalled();
  });
});
