/**
 * FROZEN PERMISSION CATALOG — single source of truth for the entire RBAC system.
 *
 * Mirrors docs/rbac-permission-catalog.md (frozen 2026-07-08). Backend guards,
 * frontend gating, middleware, seeders, role presets, and the permission-management
 * UI all derive their permission strings from here — never hand-type a permission.
 *
 * Convention: `resource:action`, lowercase, single `:` separator, snake_case segments.
 * The reserved `page` action is a module's route/navigation permission.
 *
 * ⚠️ Do NOT rename existing permissions without explicit owner approval. Adding a new
 * module = add one entry below (+ a Page Registry row in page-registry.ts if navigable).
 */

/** One catalog entry per resource. `navigable` resources own a `:page` permission. */
interface ResourceDefinition {
  /** Human label for the module (permission-management UI group header). */
  readonly label: string;
  /** True when the resource has a dedicated page/route (owns a `:page` action). */
  readonly navigable: boolean;
  /** Action verbs for this resource. `page` (when present) must be listed first. */
  readonly actions: readonly string[];
}

/**
 * The catalog. `as const` makes every action a string literal so the `Permission`
 * union below is derived precisely (e.g. `dashboard:page`), not a loose `string`.
 */
export const PERMISSION_CATALOG = {
  dashboard: { label: 'Dashboard', navigable: true, actions: ['page', 'view'] },
  users: {
    label: 'Users',
    navigable: true,
    actions: ['page', 'view', 'create', 'update', 'deactivate', 'restore', 'delete'],
  },
  roles: {
    label: 'Roles & Access Control',
    navigable: true,
    actions: ['page', 'view', 'create', 'update', 'delete', 'clone', 'reset', 'assign', 'manage_overrides'],
  },
  customers: {
    label: 'Customers',
    navigable: true,
    // view_financial: financial/consumption summaries (financial-summary, consumption).
    // update_location: GPS pinning, separate from general edit (update).
    actions: [
      'page',
      'view',
      'view_financial',
      'create',
      'update',
      'update_location',
      'deactivate',
      'restore',
      'delete',
      'export',
      'manage_portal',
    ],
  },
  orders: {
    label: 'Orders',
    navigable: true,
    actions: ['page', 'view', 'approve', 'reject', 'dispatch'],
  },
  products: {
    label: 'Products',
    navigable: true,
    actions: ['page', 'view', 'create', 'update', 'delete'],
  },
  pricing: { label: 'Pricing', navigable: true, actions: ['page', 'view', 'update'] },
  inventory: {
    label: 'Inventory / Warehouse',
    navigable: true,
    actions: ['page', 'view', 'add_stock', 'adjust', 'write_off', 'mark_damaged', 'manage_repairs'],
  },
  payments: {
    label: 'Payments',
    navigable: true,
    actions: ['page', 'view', 'approve', 'reject'],
  },
  transactions: {
    label: 'Transactions',
    navigable: true,
    actions: ['page', 'view', 'record_payment', 'adjust'],
  },
  daily_sheets: {
    label: 'Daily Sheets',
    navigable: true,
    actions: [
      'page',
      'view',
      'generate',
      'update',
      'load_out',
      'check_in',
      'close',
      'confirm_crew',
      'swap_assignment',
      'bulk_import',
      'manage_edit_locks',
      'correct', // admin-only financial correction entry
      'export',
    ],
  },
  vans: {
    label: 'Vans',
    navigable: true,
    actions: ['page', 'view', 'create', 'update', 'deactivate', 'restore', 'delete', 'manage_crew'],
  },
  routes: {
    label: 'Routes',
    navigable: true,
    actions: ['page', 'view', 'create', 'update', 'delete'],
  },
  tracking: {
    label: 'Live Tracking',
    navigable: true,
    actions: ['page', 'view', 'report_location'],
  },
  delivery_issues: {
    label: 'Delivery Issues',
    navigable: true,
    actions: ['page', 'view', 'plan', 'resolve'],
  },
  damage_cases: {
    label: 'Damage Cases',
    navigable: true,
    actions: ['page', 'view', 'create', 'update', 'review', 'charge', 'waive', 'reverse'],
  },
  expenses: {
    label: 'Expenses',
    navigable: true,
    actions: ['page', 'view', 'create', 'update', 'delete'],
  },
  analytics: { label: 'Analytics', navigable: true, actions: ['page', 'view', 'export'] },
  tickets: { label: 'Tickets', navigable: true, actions: ['page', 'view', 'reply'] },
  notifications: {
    label: 'Notification Controls',
    navigable: true,
    actions: ['page', 'view', 'configure'],
  },
  balance_reminders: {
    label: 'Balance Reminders',
    navigable: true,
    actions: ['page', 'view', 'send', 'configure'],
  },
  audit_logs: { label: 'Audit Logs', navigable: true, actions: ['page', 'view'] },
  settings: { label: 'Settings', navigable: true, actions: ['page', 'view', 'update'] },
  // Non-navigable: surfaced inside Settings, no dedicated route → no `:page`.
  whatsapp: { label: 'WhatsApp Integration', navigable: false, actions: ['view', 'manage'] },
} as const satisfies Record<string, ResourceDefinition>;

/** Union of every resource key, e.g. `'customers' | 'orders' | …`. */
export type Resource = keyof typeof PERMISSION_CATALOG;

/**
 * Precise union of every valid permission string, derived from the catalog —
 * e.g. `'dashboard:page' | 'dashboard:view' | 'users:page' | …`.
 */
export type Permission = {
  [R in Resource]: `${R}:${(typeof PERMISSION_CATALOG)[R]['actions'][number]}`;
}[Resource];

/** A permission that grants access to a module's page/route (ends in `:page`). */
export type PagePermission = Extract<Permission, `${string}:page`>;

/** All resource keys as a runtime array. */
export const RESOURCES = Object.keys(PERMISSION_CATALOG) as Resource[];

/** Flat list of all permissions in catalog order (page action first per group). */
export const PERMISSIONS: readonly Permission[] = RESOURCES.flatMap((resource) =>
  PERMISSION_CATALOG[resource].actions.map((action) => `${resource}:${action}` as Permission),
);

/** O(1) membership set for validation. */
export const PERMISSION_SET: ReadonlySet<Permission> = new Set(PERMISSIONS);

/** All `:page` permissions (one per navigable module). */
export const PAGE_PERMISSIONS: readonly PagePermission[] = PERMISSIONS.filter(
  (p): p is PagePermission => p.endsWith(':page'),
);

/** Runtime type guard — true when the string is a known catalog permission. */
export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && PERMISSION_SET.has(value as Permission);
}

/** Split a permission into its `[resource, action]` parts. */
export function splitPermission(permission: Permission): [Resource, string] {
  const idx = permission.indexOf(':');
  return [permission.slice(0, idx) as Resource, permission.slice(idx + 1)];
}
