import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { navigationMockFactory, routerMock, setMockNavigation } from '../../../../test/mocks/next-navigation';
import { renderWithQuery } from '../../../../test/utils/render';
import { LoginForm } from './login-form';
import { ForgotPasswordForm } from './forgot-password-form';
import { ResetPasswordForm } from './reset-password-form';
import { authApi } from '../api/auth.api';

jest.mock('next/navigation', () => navigationMockFactory());
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('../api/auth.api', () => ({
  authApi: { login: jest.fn(), logout: jest.fn(), me: jest.fn(), forgotPassword: jest.fn(), resetPassword: jest.fn() },
}));

const api = authApi as jest.Mocked<typeof authApi>;
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('LoginForm (A7)', () => {
  beforeEach(() => setMockNavigation('/auth/login'));

  it('has no sign-up link', () => {
    renderWithQuery(<LoginForm />);
    expect(screen.queryByText(/sign up/i)).toBeNull();
    expect(document.querySelector('a[href*="signup"]')).toBeNull();
  });

  it('shows validation messages', async () => {
    renderWithQuery(<LoginForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));
    await screen.findByText('Email is required');
    expect(screen.getByText('Password must be at least 6 characters')).toBeTruthy();
  });

  it('disables submit while pending', async () => {
    api.login.mockReturnValue(new Promise(() => undefined));
    renderWithQuery(<LoginForm />);
    type('Email', 'a@b.com');
    type('Password', 'secret1');
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Logging in...' }) as HTMLButtonElement).disabled).toBe(true));
  });

  it('shows the forbidden banner', () => {
    setMockNavigation('/auth/login', 'reason=forbidden');
    renderWithQuery(<LoginForm />);
    expect(screen.getByTestId('login-banner').textContent).toContain('platform administrators only');
  });

  it('shows the reset success banner', () => {
    setMockNavigation('/auth/login', 'reset=success');
    renderWithQuery(<LoginForm />);
    expect(screen.getByTestId('login-banner').textContent).toContain('password has been reset');
  });
});

describe('ForgotPasswordForm (A6)', () => {
  it('posts the email and shows the neutral backend message', async () => {
    api.forgotPassword.mockResolvedValue({ message: 'If the email exists, a reset link has been generated' });
    render(<ForgotPasswordForm />);
    type('Email', 'a@b.com');
    fireEvent.click(screen.getByRole('button', { name: 'Send Reset Link' }));
    await screen.findByText('If the email exists, a reset link has been generated');
    expect(api.forgotPassword).toHaveBeenCalledWith('a@b.com');
  });

  it('shows a friendly message on 429', async () => {
    api.forgotPassword.mockRejectedValue({ response: { status: 429 } });
    render(<ForgotPasswordForm />);
    type('Email', 'a@b.com');
    fireEvent.click(screen.getByRole('button', { name: 'Send Reset Link' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Too many requests');
  });
});

describe('ResetPasswordForm (A6)', () => {
  it('without token shows invalid link and never calls the API', () => {
    setMockNavigation('/auth/reset-password', '');
    render(<ResetPasswordForm />);
    expect(screen.getByText('Invalid or missing reset link')).toBeTruthy();
    expect(api.resetPassword).not.toHaveBeenCalled();
  });

  it('with token posts {token,newPassword} and redirects with reset=success', async () => {
    setMockNavigation('/auth/reset-password', 'token=abc123');
    api.resetPassword.mockResolvedValue({ message: 'ok' });
    render(<ResetPasswordForm />);
    type('New Password', 'newpass1');
    type('Confirm New Password', 'newpass1');
    fireEvent.click(screen.getByRole('button', { name: 'Reset Password' }));
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/auth/login?reset=success'));
    expect(api.resetPassword).toHaveBeenCalledWith('abc123', 'newpass1');
  });

  it('blocks mismatched passwords', async () => {
    setMockNavigation('/auth/reset-password', 'token=abc123');
    render(<ResetPasswordForm />);
    type('New Password', 'newpass1');
    type('Confirm New Password', 'different');
    fireEvent.click(screen.getByRole('button', { name: 'Reset Password' }));
    await screen.findByText("Passwords don't match");
    expect(api.resetPassword).not.toHaveBeenCalled();
  });

  it('shows the backend message on 400', async () => {
    setMockNavigation('/auth/reset-password', 'token=abc123');
    api.resetPassword.mockRejectedValue({ response: { status: 400, data: { message: 'Invalid or expired token' } } });
    render(<ResetPasswordForm />);
    type('New Password', 'newpass1');
    type('Confirm New Password', 'newpass1');
    fireEvent.click(screen.getByRole('button', { name: 'Reset Password' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Invalid or expired token');
  });
});
