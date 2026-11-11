import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithQuery } from '../../../../test/utils/render';
import { impersonationApi } from '../api/impersonation.api';
import { ImpersonateDialog } from './impersonate-dialog';
import { ImpersonationSessionsTab } from './impersonation-sessions-tab';

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('../api/impersonation.api', () => ({
  ...jest.requireActual('../api/impersonation.api'),
  impersonationApi: { start: jest.fn(), list: jest.fn(), revoke: jest.fn() },
}));
const api = impersonationApi as unknown as Record<string, jest.Mock>;

beforeEach(() => jest.clearAllMocks());

describe('ImpersonateDialog', () => {
  const setup = () => renderWithQuery(<ImpersonateDialog vendorId="v1" vendorName="Aqua" open onOpenChange={jest.fn()} />);

  it('requires a reason of at least 10 characters and defaults to read-only', () => {
    setup();
    const submit = screen.getByRole('button', { name: 'Start impersonation' }) as HTMLButtonElement;
    expect((screen.getByLabelText(/Read-only/) as HTMLInputElement).checked).toBe(true);
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'too short' } });
    expect(submit.disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toMatch(/at least 10/);
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Support ticket 123 check' } });
    expect(submit.disabled).toBe(false);
  });

  it('offers only backend-allowed durations', () => {
    setup();
    const opts = Array.from((screen.getByLabelText('Duration') as HTMLSelectElement).options).map((o) => o.value);
    expect(opts).toEqual(['15', '30', '60']);
  });

  it('starts a session and opens the handoff URL', async () => {
    const open = jest.spyOn(window, 'open').mockReturnValue(null);
    api.start.mockResolvedValue({ sessionId: 's1', handoffUrl: 'http://vd/auth/impersonate?code=abc', expiresAt: new Date().toISOString(), target: { id: 'u', name: 'Admin', email: 'a@x.com' } });
    setup();
    fireEvent.click(screen.getByLabelText(/Support/));
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Support ticket 123 check' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start impersonation' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith('http://vd/auth/impersonate?code=abc', '_blank', 'noopener'));
    expect(api.start.mock.calls[0][0]).toEqual({ vendorId: 'v1', reason: 'Support ticket 123 check', mode: 'SUPPORT', ttlMinutes: 30 });
    expect((await screen.findByTestId('handoff-link')).getAttribute('href')).toBe('http://vd/auth/impersonate?code=abc');
    open.mockRestore();
  });

  it('shows the API error', async () => {
    api.start.mockRejectedValue({ response: { data: { message: 'Cannot impersonate a suspended vendor.' } } });
    setup();
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Support ticket 123 check' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start impersonation' }));
    expect(await screen.findByText(/suspended vendor/)).toBeTruthy();
  });
});

describe('ImpersonationSessionsTab', () => {
  const row = (o = {}) => ({
    id: 's1', actorId: 'a', actorName: 'Super', vendorId: 'v1', targetUserId: 'u', targetName: 'Admin', mode: 'READ_ONLY', reason: 'ticket 123 check',
    startedAt: '2026-01-01T00:00:00Z', expiresAt: '2099-01-01T00:00:00Z', endedAt: null, endedReason: null, actionCount: 2, ...o,
  });

  it('lists sessions scoped to the vendor and revokes an active one', async () => {
    api.list.mockResolvedValue({ data: [row(), row({ id: 's2', endedAt: '2026-01-01T01:00:00Z', endedReason: 'EXIT' })], meta: { total: 2, page: 1, limit: 20 } });
    api.revoke.mockResolvedValue(row());
    renderWithQuery(<ImpersonationSessionsTab vendorId="v1" />);
    expect(await screen.findByTestId('session-live')).toBeTruthy();
    expect(screen.getByText('exit')).toBeTruthy();
    expect(api.list.mock.calls[0][0]).toMatchObject({ vendorId: 'v1' });
    expect(screen.getAllByRole('button', { name: /Revoke session/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Revoke session s1' }));
    await waitFor(() => expect(api.revoke).toHaveBeenCalled());
    expect(api.revoke.mock.calls[0][0]).toBe('s1');
  });
});
