import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ForgotPasswordForm } from './forgot-password-form';
import { useForgotPassword } from '../hooks/use-auth';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

jest.mock('../hooks/use-auth', () => ({
  useForgotPassword: jest.fn(),
}));

const mockUseForgotPassword = useForgotPassword as jest.MockedFunction<typeof useForgotPassword>;

describe('ForgotPasswordForm', () => {
  const mutate = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseForgotPassword.mockReturnValue({
      mutate,
      isPending: false,
    } as ReturnType<typeof useForgotPassword>);
  });

  it('shows the live email validation message', async () => {
    render(<ForgotPasswordForm />);

    fireEvent.click(screen.getByRole('button', { name: 'Send Reset Link' }));

    expect(await screen.findByText('Invalid email address')).toBeTruthy();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('submits the email address when valid', async () => {
    render(<ForgotPasswordForm />);

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'admin@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send Reset Link' }));

    await waitFor(() => expect(mutate).toHaveBeenCalledWith('admin@example.com'));
  });
});
