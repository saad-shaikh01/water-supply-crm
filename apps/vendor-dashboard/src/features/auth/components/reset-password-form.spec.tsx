import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ResetPasswordForm } from './reset-password-form';
import { useResetPassword } from '../hooks/use-auth';

jest.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: (key: string) => (key === 'token' ? 'reset-token-123' : null),
  }),
}));

jest.mock('../hooks/use-auth', () => ({
  useResetPassword: jest.fn(),
}));

const mockUseResetPassword = useResetPassword as jest.MockedFunction<typeof useResetPassword>;

describe('ResetPasswordForm', () => {
  const mutate = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseResetPassword.mockReturnValue({
      mutate,
      isPending: false,
    } as ReturnType<typeof useResetPassword>);
  });

  it('blocks mismatched passwords', async () => {
    render(<ResetPasswordForm />);

    fireEvent.change(screen.getByLabelText('New Password'), {
      target: { value: 'secret123' },
    });
    fireEvent.change(screen.getByLabelText('Confirm Password'), {
      target: { value: 'secret999' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reset Password' }));

    expect(await screen.findByText("Passwords don't match")).toBeTruthy();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('submits the token and password when valid', async () => {
    render(<ResetPasswordForm />);

    fireEvent.change(screen.getByLabelText('New Password'), {
      target: { value: 'secret123' },
    });
    fireEvent.change(screen.getByLabelText('Confirm Password'), {
      target: { value: 'secret123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reset Password' }));

    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith({
        token: 'reset-token-123',
        password: 'secret123',
      })
    );
  });
});
