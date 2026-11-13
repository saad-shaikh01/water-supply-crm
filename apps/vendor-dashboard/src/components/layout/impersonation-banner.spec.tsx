import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImpersonationBanner } from './impersonation-banner';
import { impersonationApi } from '../../features/impersonation/api/impersonation.api';
import { formatRemaining, navigateTo } from '../../features/impersonation/session';

jest.mock('../../features/impersonation/session', () => ({
  ...jest.requireActual('../../features/impersonation/session'),
  navigateTo: jest.fn(),
}));
const assign = navigateTo as jest.Mock;

let mockInfo: unknown = null;
let mockActive = false;
jest.mock('../../features/impersonation/hooks/use-impersonation', () => ({
  useImpersonation: () => ({ active: mockActive, info: mockInfo }),
}));
jest.mock('../../features/impersonation/api/impersonation.api', () => ({
  impersonationApi: { exit: jest.fn(async () => ({ data: { ok: true } })) },
}));
jest.mock('../../store/auth.store', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { name: 'Vendor Admin' }, clearUser: jest.fn() }),
}));

beforeEach(() => {
  assign.mockClear();
  (impersonationApi.exit as jest.Mock).mockClear();
  mockActive = true;
  mockInfo = { sessionId: 's1', actorName: 'Super Admin', mode: 'READ_ONLY', expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() };
});

const renderBanner = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ImpersonationBanner />
    </QueryClientProvider>,
  );

describe('ImpersonationBanner', () => {
  it('renders nothing for an ordinary session', () => {
    mockActive = false;
    renderBanner();
    expect(screen.queryByTestId('impersonation-banner')).toBeNull();
  });

  it('shows actor, mode and countdown, with no dismiss control', () => {
    renderBanner();
    const banner = screen.getByTestId('impersonation-banner');
    expect(banner.textContent).toMatch(/Vendor Admin/);
    expect(banner.textContent).toMatch(/Super Admin/);
    expect(banner.textContent).toMatch(/Read-only/);
    expect(banner.textContent).toMatch(/expires in 0[45]:\d\d/);
    expect(screen.getAllByRole('button')).toHaveLength(1); // Exit only
  });

  it('Exit calls the API then leaves to the ended screen', async () => {
    renderBanner();
    fireEvent.click(screen.getByRole('button', { name: /exit/i }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/auth/impersonate/ended'));
    expect(impersonationApi.exit).toHaveBeenCalled();
  });

  it('countdown reaching 0 ends the session screen', async () => {
    jest.useFakeTimers();
    mockInfo = { sessionId: 's1', actorName: 'Super Admin', mode: 'SUPPORT', expiresAt: new Date(Date.now() + 2000).toISOString() };
    renderBanner();
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    expect(assign).toHaveBeenCalledWith('/auth/impersonate/ended');
    jest.useRealTimers();
  });
});

describe('formatRemaining', () => {
  it('formats mm:ss and clamps at zero', () => {
    expect(formatRemaining(61_000)).toBe('01:01');
    expect(formatRemaining(-5)).toBe('00:00');
  });
});
