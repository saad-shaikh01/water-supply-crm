import { apiClient, unwrap } from '../../../lib/api';

export type SettingValue = boolean | number | string | null;

export interface PlatformSettingEntry {
  key: string;
  value: SettingValue;
  default: SettingValue;
  description: string;
  type: 'boolean' | 'string' | 'int' | 'isoDate';
  updatedAt: string | null;
  updatedBy: { id: string; name: string } | null;
}

export interface PlatformSettingsResponse {
  settings: PlatformSettingEntry[];
}

export const settingsApi = {
  list: () => unwrap(apiClient.get<PlatformSettingsResponse>('/platform-settings')),
  /** Atomic batch: either every key is written or none. */
  patch: (body: Record<string, SettingValue>) => unwrap(apiClient.patch<Record<string, SettingValue>>('/platform-settings', body)),
};

/** Registry keys the UI knows about; anything else is shown generically (flags.*) or ignored. */
export const SETTING_KEYS = {
  maintenanceEnabled: 'maintenance.enabled',
  maintenanceMessage: 'maintenance.message',
  maintenanceEta: 'maintenance.eta',
  defaultGrouping: 'defaults.customerGroupingEnabled',
  require2fa: 'security.require2faForSuperAdmin',
  loginMaxAttempts: 'security.loginMaxAttempts',
  loginLockMinutes: 'security.loginLockMinutes',
} as const;
