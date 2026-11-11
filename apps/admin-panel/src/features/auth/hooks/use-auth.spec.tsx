import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import { navigationMockFactory, routerMock } from '../../../../test/mocks/next-navigation';
import { createTestQueryClient } from '../../../../test/utils/render';
import { useLogin, useLogout } from './use-auth';
import { authApi } from '../api/auth.api';
import { useAuthStore } from '../../../store/auth.store';

jest.mock('next/navigation', () => navigationMockFactory());
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('../api/auth.api', () => ({
  authApi: { login: jest.fn(), logout: jest.fn(), me: jest.fn(), forgotPassword: jest.fn(), resetPassword: jest.fn() },
}));

const api = authApi as jest.Mocked<typeof authApi>;
const client = createTestQueryClient();
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

const cookieNames = () =>
  document.cookie
    .split(';')
    .map((c) => c.trim().split('=')[0])
    .filter(Boolean);

const loginResponse = (role: string) => ({
  access_token: 'AT',
  refresh_token: 'RT',
  user: { id: 'u1', name: 'N', email: 'e@x.com', role },
});

function clearCookies() {
  cookieNames().forEach((n) => {
    document.cookie = `${n}=; max-age=0; path=/`;
  });
}

beforeEach(() => {
  clearCookies();
  useAuthStore.setState({ user: null });
  api.logout.mockResolvedValue({ message: 'ok' });
});

describe('useLogin', () => {
  it('A1: SUPER_ADMIN sets cookies, store and redirects to /', async () => {
    api.login.mockResolvedValue(loginResponse('SUPER_ADMIN'));
    const { result } = renderHook(() => useLogin(), { wrapper });
    act(() => result.current.mutate({ identifier: 'a@b.com', password: 'secret1' }));
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/'));
    expect(cookieNames()).toEqual(expect.arrayContaining(['auth_token', 'refresh_token', 'user_role']));
    expect(document.cookie).toContain('user_role=SUPER_ADMIN');
    expect(useAuthStore.getState().user?.role).toBe('SUPER_ADMIN');
  });

  it.each(['VENDOR_ADMIN', 'DRIVER', 'CUSTOMER'])('A2: %s is rejected, revoked, nothing stored', async (role) => {
    api.login.mockResolvedValue(loginResponse(role));
    const { result } = renderHook(() => useLogin(), { wrapper });
    act(() => result.current.mutate({ identifier: 'a@b.com', password: 'secret1' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect((toast.error as jest.Mock).mock.calls[0][0]).toContain('platform administrators only');
    expect(api.logout).toHaveBeenCalledWith('RT');
    expect(cookieNames()).toEqual([]);
    expect(useAuthStore.getState().user).toBeNull();
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it.each([
    [{ response: { status: 401, data: { message: 'Invalid credentials' } } }, 'Invalid credentials'],
    [{ response: { status: 401, data: { message: 'Account temporarily locked. Try again later' } } }, 'Account temporarily locked. Try again later'],
    [{ response: { status: 429 } }, 'Too many requests'],
  ])('A3: surfaces backend error %#', async (err, text) => {
    api.login.mockRejectedValue(err);
    const { result } = renderHook(() => useLogin(), { wrapper });
    act(() => result.current.mutate({ identifier: 'a@b.com', password: 'secret1' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect((toast.error as jest.Mock).mock.calls[0][0]).toContain(text);
  });
});

describe('useLogout', () => {
  it('A4: revokes server-side, clears cookies/store/cache, navigates to login', async () => {
    document.cookie = 'auth_token=AT; path=/';
    document.cookie = 'refresh_token=RT; path=/';
    document.cookie = 'user_role=SUPER_ADMIN; path=/';
    useAuthStore.setState({ user: { id: '1', name: 'n', email: 'e', role: 'SUPER_ADMIN' } });
    client.setQueryData(['x'], 1);
    const { result } = renderHook(() => useLogout(), { wrapper });
    act(() => result.current());
    expect(api.logout).toHaveBeenCalledWith('RT');
    expect(cookieNames()).toEqual([]);
    expect(useAuthStore.getState().user).toBeNull();
    expect(client.getQueryData(['x'])).toBeUndefined();
    expect(routerMock.replace).toHaveBeenCalledWith('/auth/login');
  });

  it('A4: still clears locally when the API call fails', () => {
    document.cookie = 'refresh_token=RT; path=/';
    api.logout.mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useLogout(), { wrapper });
    act(() => result.current());
    expect(cookieNames()).toEqual([]);
    expect(routerMock.replace).toHaveBeenCalledWith('/auth/login');
  });
});
