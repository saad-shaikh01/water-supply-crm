import { render, screen, waitFor } from '@testing-library/react';
import ImpersonateExchangePage from './page';
import { impersonationApi } from '../../../features/impersonation/api/impersonation.api';
import { useAuthStore } from '../../../store/auth.store';

let mockCode: string | null = 'abc';
jest.mock('next/navigation', () => ({ useSearchParams: () => ({ get: () => mockCode }) }));
jest.mock('../../../features/impersonation/api/impersonation.api', () => ({
  impersonationApi: { exchange: jest.fn() },
}));
jest.mock('../../../features/impersonation/session', () => ({
  clearAuthCookies: jest.fn(),
  startImpersonationCookies: jest.fn(),
}));

const exchange = impersonationApi.exchange as jest.Mock;

beforeEach(() => {
  exchange.mockReset();
  mockCode = 'abc';
  useAuthStore.setState({ user: null });
});

describe('ImpersonateExchangePage', () => {
  it('shows the invalid-link message (no redirect) when the code is spent or expired', async () => {
    exchange.mockRejectedValue({ response: { status: 401 } });
    render(<ImpersonateExchangePage />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/invalid, expired or has already been used/);
  });

  it('refuses a missing code without calling the API', async () => {
    mockCode = null;
    render(<ImpersonateExchangePage />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/Missing handoff code/);
    expect(exchange).not.toHaveBeenCalled();
  });

  it('stores the impersonated vendor user so the banner/header can name them', async () => {
    const user = { id: 'u1', email: 'a@b.c', name: 'Vendor Admin', role: 'VENDOR_ADMIN', vendorId: 'v1' };
    exchange.mockResolvedValue({ data: { access_token: 't', user, impersonation: {} } });
    render(<ImpersonateExchangePage />);
    await waitFor(() => expect(useAuthStore.getState().user?.name).toBe('Vendor Admin'));
  });
});
