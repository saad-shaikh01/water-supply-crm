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

export type ImportEntityKey = 'CUSTOMERS_OPENING' | 'TRANSACTION_HISTORY';

export const IMPORT_ENTITY: ImportEntityKey = 'CUSTOMERS_OPENING';
export const HISTORY_ENTITY: ImportEntityKey = 'TRANSACTION_HISTORY';

/** What the upload step offers. Caps mirror the server (apps/api-backend/.../import.constants.ts). */
export const IMPORT_ENTITIES: {
  key: ImportEntityKey;
  title: string;
  description: string;
  accept: string[];
  maxMb: number;
  maxRows: number;
  dropText: string;
}[] = [
  {
    key: 'CUSTOMERS_OPENING',
    title: 'Customers & opening balances',
    description: 'Bring in your customer list with what each one owes and how many bottles they hold. Nothing else is created.',
    accept: ['.xlsx', '.csv'],
    maxMb: 5,
    maxRows: 5000,
    dropText: 'Drop your customer Excel / CSV here, or click to browse',
  },
  {
    key: 'TRANSACTION_HISTORY',
    title: 'Transaction history',
    description: 'Past deliveries, payments and bottle movement for customers that already exist, so their statements show the full history. Balances are not changed.',
    accept: ['.xlsx', '.csv', '.html', '.htm'],
    maxMb: 50,
    maxRows: 100000,
    dropText: 'Drop your history file (Excel, CSV or HTML export) here, or click to browse',
  },
];

export const entityInfo = (k: string | undefined) => IMPORT_ENTITIES.find((e) => e.key === k) ?? IMPORT_ENTITIES[0];

export const IMPORT_MAX_MB = 5;
