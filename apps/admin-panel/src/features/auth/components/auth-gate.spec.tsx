import { screen, waitFor } from '@testing-library/react';
import { navigationMockFactory, routerMock } from '../../../../test/mocks/next-navigation';
import { renderWithQuery } from '../../../../test/utils/render';
import { AuthGate } from './auth-gate';
import { authApi } from '../api/auth.api';
import { useAuthStore } from '../../../store/auth.store';

jest.mock('next/navigation', () => navigationMockFactory());
jest.mock('../api/auth.api', () => ({ authApi: { me: jest.fn() } }));

const me = authApi.me as jest.Mock;
const Child = () => <div>secret dashboard</div>;

beforeEach(() => useAuthStore.setState({ user: null }));

describe('AuthGate', () => {
  it('shows spinner, not children, while loading', () => {
    me.mockReturnValue(new Promise(() => undefined));
    renderWithQuery(<AuthGate><Child /></AuthGate>);
    expect(screen.queryByText('secret dashboard')).toBeNull();
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('renders children for SUPER_ADMIN and refreshes the store', async () => {
    me.mockResolvedValue({ id: '1', name: 'Root', email: 'r@x.com', role: 'SUPER_ADMIN' });
    renderWithQuery(<AuthGate><Child /></AuthGate>);
    await screen.findByText('secret dashboard');
    await waitFor(() => expect(useAuthStore.getState().user?.name).toBe('Root'));
  });

  it('401 -> clears session and redirects with reason=expired', async () => {
    useAuthStore.setState({ user: { id: '1', name: 'x', email: 'e', role: 'SUPER_ADMIN' } });
    me.mockRejectedValue({ response: { status: 401 } });
    renderWithQuery(<AuthGate><Child /></AuthGate>);
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/auth/login?reason=expired'));
    expect(screen.queryByText('secret dashboard')).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('non-admin role -> reason=forbidden, children never shown', async () => {
    me.mockResolvedValue({ id: '2', name: 'V', email: 'v@x.com', role: 'VENDOR_ADMIN' });
    renderWithQuery(<AuthGate><Child /></AuthGate>);
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/auth/login?reason=forbidden'));
    expect(screen.queryByText('secret dashboard')).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('network error shows retryable error, does not log out', async () => {
    me.mockRejectedValue({ code: 'ERR_NETWORK', message: 'Network Error' });
    renderWithQuery(<AuthGate><Child /></AuthGate>);
    await screen.findByRole('alert');
    expect(routerMock.replace).not.toHaveBeenCalled();
  });
});
