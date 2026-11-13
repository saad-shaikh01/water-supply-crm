import { fireEvent, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { navigationMockFactory, setMockNavigation } from '../../../../test/mocks/next-navigation';
import { renderWithQuery } from '../../../../test/utils/render';
import { SettingsPageClient } from './settings-page-client';
import { MaintenanceBanner } from './maintenance-banner';
import { validateInt } from './security-policy-card';
import { isoToLocalInput, localInputToIso } from './maintenance-card';
import { settingsApi, type PlatformSettingEntry } from '../api/settings.api';

jest.mock('next/navigation', () => navigationMockFactory());
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn(), warning: jest.fn() } }));
jest.mock('../api/settings.api', () => ({
  ...jest.requireActual('../api/settings.api'),
  settingsApi: { list: jest.fn(), patch: jest.fn() },
}));

const api = settingsApi as jest.Mocked<typeof settingsApi>;

const entry = (key: string, value: PlatformSettingEntry['value'], type: PlatformSettingEntry['type'] = 'boolean'): PlatformSettingEntry => ({
  key,
  value,
  default: value,
  description: `desc ${key}`,
  type,
  updatedAt: null,
  updatedBy: null,
});
const base = (over: Record<string, PlatformSettingEntry['value']> = {}) => {
  const v = {
    'maintenance.enabled': false,
    'maintenance.message': '',
    'maintenance.eta': null,
    'defaults.customerGroupingEnabled': false,
    'security.require2faForSuperAdmin': false,
    'security.loginMaxAttempts': 5,
    'security.loginLockMinutes': 15,
    ...over,
  };
  return {
    settings: [
      entry('maintenance.enabled', v['maintenance.enabled']),
      entry('maintenance.message', v['maintenance.message'], 'string'),
      entry('maintenance.eta', v['maintenance.eta'], 'isoDate'),
      entry('defaults.customerGroupingEnabled', v['defaults.customerGroupingEnabled']),
      entry('security.require2faForSuperAdmin', v['security.require2faForSuperAdmin']),
      entry('security.loginMaxAttempts', v['security.loginMaxAttempts'], 'int'),
      entry('security.loginLockMinutes', v['security.loginLockMinutes'], 'int'),
      ...(over['flags.beta'] !== undefined ? [entry('flags.beta', over['flags.beta'])] : []),
    ],
  };
};

beforeEach(() => {
  setMockNavigation('/settings');
  api.list.mockResolvedValue(base());
  api.patch.mockResolvedValue({});
});

const tab = (name: string) => fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0, ctrlKey: false });

describe('SettingsPageClient: maintenance', () => {
  it('toggling ON opens a confirm dialog; confirming PATCHes enabled + message + eta', async () => {
    renderWithQuery(<SettingsPageClient />);
    const toggle = await screen.findByRole('switch', { name: 'Maintenance mode' });
    fireEvent.click(toggle);
    expect(api.patch).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Back soon' } });
    fireEvent.click(screen.getByRole('button', { name: 'Turn maintenance ON' }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith({
        'maintenance.enabled': true,
        'maintenance.message': 'Back soon',
        'maintenance.eta': null,
      }),
    );
  });

  it('failure rolls the toggle back and toasts the server message', async () => {
    api.patch.mockRejectedValue({ response: { status: 400, data: { message: 'invalid value' } } });
    renderWithQuery(<SettingsPageClient />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Maintenance mode' }));
    fireEvent.click(screen.getByRole('button', { name: 'Turn maintenance ON' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('invalid value'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Maintenance mode' }).getAttribute('aria-checked')).toBe('false'));
  });

  it('turning OFF patches immediately without a dialog', async () => {
    api.list.mockResolvedValue(base({ 'maintenance.enabled': true, 'maintenance.message': 'x' }));
    renderWithQuery(<SettingsPageClient />);
    const toggle = await screen.findByRole('switch', { name: 'Maintenance mode' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith({ 'maintenance.enabled': false }));
  });

  it('rejects a message over 500 characters', async () => {
    renderWithQuery(<SettingsPageClient />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Maintenance mode' }));
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'x'.repeat(501) } });
    expect(screen.getByText('Message must be at most 500 characters')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Turn maintenance ON' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('SettingsPageClient: other tabs', () => {
  it('lists feature flags from the registry (or an empty state)', async () => {
    renderWithQuery(<SettingsPageClient />);
    await screen.findByRole('switch', { name: 'Maintenance mode' });
    tab('Feature flags');
    await screen.findByText('No feature flags are defined yet.');
  });

  it('renders flags.* entries and toggles them optimistically', async () => {
    api.list.mockResolvedValue(base({ 'flags.beta': false }));
    renderWithQuery(<SettingsPageClient />);
    await screen.findByRole('switch', { name: 'Maintenance mode' });
    tab('Feature flags');
    const sw = await screen.findByRole('switch', { name: 'flags.beta' });
    fireEvent.click(sw);
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith({ 'flags.beta': true }));
  });

  it('defaults tab says it applies to new vendors and patches the default', async () => {
    renderWithQuery(<SettingsPageClient />);
    await screen.findByRole('switch', { name: 'Maintenance mode' });
    tab('Defaults');
    await screen.findByText(/newly created vendors only/i);
    fireEvent.click(screen.getByRole('switch', { name: 'Enable customer grouping' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith({ 'defaults.customerGroupingEnabled': true }));
  });

  it('security policy: save bar only when dirty, validates ranges, saves numbers', async () => {
    renderWithQuery(<SettingsPageClient />);
    await screen.findByRole('switch', { name: 'Maintenance mode' });
    tab('Security policy');
    await screen.findByTestId('security-policy-card');
    expect(screen.queryByTestId('save-bar')).toBeNull();

    fireEvent.change(screen.getByLabelText('Failed attempts before lock'), { target: { value: '2' } });
    await screen.findByTestId('save-bar');
    expect(screen.getByText('Enter a whole number between 3 and 20')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Failed attempts before lock'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Require two-factor authentication' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith({
        'security.require2faForSuperAdmin': true,
        'security.loginMaxAttempts': 8,
        'security.loginLockMinutes': 15,
      }),
    );
  });

  it('discard hides the save bar', async () => {
    renderWithQuery(<SettingsPageClient />);
    await screen.findByRole('switch', { name: 'Maintenance mode' });
    tab('Security policy');
    fireEvent.change(await screen.findByLabelText('Lock duration (minutes)'), { target: { value: '30' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(screen.queryByTestId('save-bar')).toBeNull());
    expect((screen.getByLabelText('Lock duration (minutes)') as HTMLInputElement).value).toBe('15');
  });

  it('shows an error state when settings fail to load', async () => {
    api.list.mockRejectedValue({ response: { status: 500, data: { message: 'down' } } });
    renderWithQuery(<SettingsPageClient />);
    await screen.findByText('down');
  });
});

describe('MaintenanceBanner (header)', () => {
  it('is visible only while maintenance is enabled', async () => {
    api.list.mockResolvedValue(base({ 'maintenance.enabled': true }));
    const { unmount } = renderWithQuery(<MaintenanceBanner />);
    expect((await screen.findByTestId('maintenance-banner')).textContent).toMatch(/Maintenance mode is ON/);
    unmount();

    api.list.mockResolvedValue(base());
    renderWithQuery(<MaintenanceBanner />);
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('maintenance-banner')).toBeNull();
  });
});

describe('helpers', () => {
  it('validateInt enforces whole numbers in range', () => {
    expect(validateInt('3', 3, 20)).toBeNull();
    expect(validateInt('20', 3, 20)).toBeNull();
    expect(validateInt('21', 3, 20)).not.toBeNull();
    expect(validateInt('2.5', 3, 20)).not.toBeNull();
    expect(validateInt('', 3, 20)).not.toBeNull();
  });

  it('datetime-local conversion round-trips', () => {
    const iso = '2026-12-01T10:30:00.000Z';
    expect(localInputToIso(isoToLocalInput(iso))).toBe(iso);
    expect(localInputToIso('')).toBeNull();
    expect(isoToLocalInput(null)).toBe('');
  });
});
