/**
 * Single source of truth for platform settings. Unknown keys are rejected; settings are never secrets.
 * Add a `flags.<name>` entry here to introduce a feature flag.
 */
export type SettingType = 'boolean' | 'string' | 'int' | 'isoDate';

export interface SettingDef {
  key: string;
  type: SettingType;
  default: unknown;
  public: boolean;
  description: string;
  /** Returns an error message, or null when valid. */
  validate: (value: unknown) => string | null;
}

const bool = (v: unknown) => (typeof v === 'boolean' ? null : 'must be a boolean');
const intRange = (min: number, max: number) => (v: unknown) =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
    ? null
    : `must be an integer between ${min} and ${max}`;

export const SETTINGS_REGISTRY: SettingDef[] = [
  {
    key: 'maintenance.enabled',
    type: 'boolean',
    default: false,
    public: true,
    description: 'Block all non-platform-admin API traffic with 503 MAINTENANCE_MODE',
    validate: bool,
  },
  {
    key: 'maintenance.message',
    type: 'string',
    default: '',
    public: true,
    description: 'Message shown to users during maintenance (max 500 chars)',
    validate: (v) => (typeof v === 'string' && v.length <= 500 ? null : 'must be a string of at most 500 characters'),
  },
  {
    key: 'maintenance.eta',
    type: 'isoDate',
    default: null,
    public: true,
    description: 'Expected end of maintenance (ISO 8601) or null',
    validate: (v) =>
      v === null || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(Date.parse(v)))
        ? null
        : 'must be an ISO date string or null',
  },
  {
    key: 'defaults.customerGroupingEnabled',
    type: 'boolean',
    default: false,
    public: false,
    description: 'Default for customer grouping on NEWLY created vendors',
    validate: bool,
  },
  {
    key: 'security.require2faForSuperAdmin',
    type: 'boolean',
    default: false,
    public: false,
    description: 'Require 2FA for every platform administrator',
    validate: bool,
  },
  {
    key: 'security.loginMaxAttempts',
    type: 'int',
    default: 5,
    public: false,
    description: 'Failed logins before an account is locked (3-20)',
    validate: intRange(3, 20),
  },
  {
    key: 'security.loginLockMinutes',
    type: 'int',
    default: 15,
    public: false,
    description: 'Account lock duration in minutes (1-1440)',
    validate: intRange(1, 1440),
  },
];

export const REGISTRY_BY_KEY = new Map(SETTINGS_REGISTRY.map((d) => [d.key, d]));
