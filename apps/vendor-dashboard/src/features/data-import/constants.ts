import type { Permission } from '@water-supply-crm/authz';

/**
 * Permission gates for Vendor Data Import (owner-approved 2026-10-07). `execute` and `revert`
 * bulk-write customers and opening balances, so they are Vendor-Admin-only by default; Manager
 * can upload / map / preview (`upload`); Accountant is read-only (`view`).
 */
export const DATA_IMPORT_PERMISSIONS = {
  page: 'data_imports:page' as Permission,
  view: 'data_imports:view' as Permission,
  upload: 'data_imports:upload' as Permission,
  execute: 'data_imports:execute' as Permission,
  revert: 'data_imports:revert' as Permission,
};

export const IMPORT_ENTITY = 'CUSTOMERS_OPENING';

export const IMPORT_MAX_MB = 5;
