import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { act } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { setCookie, deleteCookie, getCookie } from 'cookies-next';
import { toast } from 'sonner';
import { authApi } from '../api/auth.api';
import { useLogin, useLogout, useResetPassword } from './use-auth';
import { queryKeys } from '../../../lib/query-keys';
import { createTestQueryClient } from '../../../test/test-utils';

const push = jest.fn();
const setUser = jest.fn();
const clearUser = jest.fn();
const clearQueryClient = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push,
  }),
}));

jest.mock('cookies-next', () => ({
  setCookie: jest.fn(),
  deleteCookie: jest.fn(),
  getCookie: jest.fn(),
}));

jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
  },
}));

jest.mock('../api/auth.api', () => ({
  authApi: {
    login: jest.fn(),
    logout: jest.fn(),
    forgotPassword: jest.fn(),
    resetPassword: jest.fn(),
  },
}));

jest.mock('../../../store/auth.store', () => ({
  useAuthStore: (selector: (state: { setUser: typeof setUser; clearUser: typeof clearUser }) => unknown) =>
    selector({ setUser, clearUser }),
}));

jest.mock('@water-supply-crm/data-access', () => ({
  apiClient: {
    post: jest.fn(),
    delete: jest.fn(),
  },
}));

describe('vendor auth hooks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function createWrapper() {
    const queryClient = createTestQueryClient();
    jest.spyOn(queryClient, 'clear').mockImplementation(() => {
      clearQueryClient();
    });

    return {
      queryClient,
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    };
  }

  it('stores cookies, hydrates the auth cache, and routes admins to overview on login', async () => {
    const { wrapper, queryClient } = createWrapper();
    (authApi.login as jest.Mock).mockResolvedValue({
      data: {
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        user: {
          id: 'vendor-user',
          name: 'Vendor Admin',
          email: 'admin@example.com',
          role: 'VENDOR_ADMIN',
          vendorId: 'vendor-1',
        },
      },
    });

    const { result } = renderHook(() => useLogin(), { wrapper });

    act(() => {
      result.current.mutate({
        identifier: 'admin@example.com',
        password: 'secret123',
      });
    });

    await waitFor(() => expect(authApi.login).toHaveBeenCalled());
    await waitFor(() => expect(setUser).toHaveBeenCalled());

    expect(setCookie).toHaveBeenCalledWith('auth_token', 'access-token', { maxAge: 86400 });
    expect(setCookie).toHaveBeenCalledWith('refresh_token', 'refresh-token', { maxAge: 604800 });
    expect(setCookie).toHaveBeenCalledWith('user_role', 'VENDOR_ADMIN', { maxAge: 604800 });
    expect(queryClient.getQueryData(queryKeys.auth.me)).toEqual({
      id: 'vendor-user',
      name: 'Vendor Admin',
      email: 'admin@example.com',
      role: 'VENDOR_ADMIN',
      vendorId: 'vendor-1',
    });
    expect(push).toHaveBeenCalledWith('/dashboard/overview');
  });

  it('routes drivers to the driver home after login', async () => {
    const { wrapper } = createWrapper();
    (authApi.login as jest.Mock).mockResolvedValue({
      data: {
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        user: {
          id: 'driver-user',
          name: 'Driver',
          email: 'driver@example.com',
          role: 'DRIVER',
          vendorId: 'vendor-1',
        },
      },
    });

    const { result } = renderHook(() => useLogin(), { wrapper });

    act(() => {
      result.current.mutate({
        identifier: 'driver@example.com',
        password: 'secret123',
      });
    });

    await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard/home'));
  });

  it('clears cookies, auth state, and query cache on logout', async () => {
    const { wrapper } = createWrapper();
    (getCookie as jest.Mock).mockReturnValue('refresh-token');
    (authApi.logout as jest.Mock).mockResolvedValue({});

    const { result } = renderHook(() => useLogout(), { wrapper });

    await act(async () => {
      await result.current();
    });

    expect(authApi.logout).toHaveBeenCalledWith('refresh-token');
    expect(deleteCookie).toHaveBeenCalledWith('auth_token');
    expect(deleteCookie).toHaveBeenCalledWith('refresh_token');
    expect(deleteCookie).toHaveBeenCalledWith('user_role');
    expect(clearUser).toHaveBeenCalled();
    expect(clearQueryClient).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith('/auth/login');
  });

  it('routes back to login after a successful password reset', async () => {
    const { wrapper } = createWrapper();
    (authApi.resetPassword as jest.Mock).mockResolvedValue({});

    const { result } = renderHook(() => useResetPassword(), { wrapper });

    act(() => {
      result.current.mutate({
        token: 'reset-token',
        password: 'secret123',
      });
    });

    await waitFor(() => expect(authApi.resetPassword).toHaveBeenCalledWith('reset-token', 'secret123'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Password reset successfully!'));
    expect(push).toHaveBeenCalledWith('/auth/login');
  });
});
