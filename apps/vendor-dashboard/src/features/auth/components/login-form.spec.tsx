import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LoginForm } from './login-form';
import { useLogin } from '../hooks/use-auth';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

jest.mock('../hooks/use-auth', () => ({
  useLogin: jest.fn(),
}));

const mockUseLogin = useLogin as jest.MockedFunction<typeof useLogin>;

describe('LoginForm', () => {
  const mutate = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLogin.mockReturnValue({
      mutate,
      isPending: false,
    } as ReturnType<typeof useLogin>);
  });

  it('validates required fields before submitting', async () => {
    render(<LoginForm />);

    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(await screen.findByText('Email or Phone Number is required')).toBeTruthy();
    expect(await screen.findByText('Password must be at least 6 characters')).toBeTruthy();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('submits the live login payload when the form is valid', async () => {
    render(<LoginForm />);

    fireEvent.change(screen.getByLabelText('Email or Phone Number'), {
      target: { value: 'admin@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'secret123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith({
        identifier: 'admin@example.com',
        password: 'secret123',
      })
    );
  });
});
