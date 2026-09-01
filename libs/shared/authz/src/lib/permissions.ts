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
    actions: ['page', 'view', 'record_payment', 'edit_payment', 'delete_payment', 'adjust'],
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
      // Soft Close (Amendment R9): request_close is the field-role's own
      // self-close action (driver/salesman); approve_close/reject_close are
      // the staff/admin review decision on a request_close'd sheet. `close`
      // itself is unchanged — the direct Staff/Admin close, skipping review.
      'request_close',
      'approve_close',
      'reject_close',
      'confirm_crew',
      'swap_assignment',
      'bulk_import',
      'manage_edit_locks',
      'correct', // admin-only financial correction entry
      'export',
      // Amendment R10 (owner-requested 2026-08-20): split out of `update` — moving a
      // customer's pending/failed delivery to a different van/sheet (PATCH
      // items/move) is now its own action, independently grantable per role instead
      // of riding along with the broad `update` grant every field role already has.
      'move_customer',
      // Void Delivery (owner-requested 2026-09-01): strike a recorded stop from
      // the operational record — reverses the ledger effect for COMPLETED/
      // EMPTY_ONLY, an operational hide + audit for the other terminal statuses.
      // Analogous to `correct`; granted to Admin + Manager.
      'void_delivery',
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
  collection_policy: {
    label: 'Collection Policy',
    navigable: true,
    actions: ['page', 'view', 'update'],
  },
  conversations: {
    label: 'Conversations',
    navigable: true,
    actions: ['page', 'view', 'create', 'send', 'acknowledge', 'manage_status'],
  },
  // Non-navigable: surfaced inside Settings, no dedicated route → no `:page`.
  whatsapp: { label: 'WhatsApp Integration', navigable: false, actions: ['view', 'manage'] },
  // Amendment R3 (Payroll Phase 1, owner-approved 2026-08-06): new resource — see
  // docs/rbac-permission-catalog.md §27 for the full amendment note.
  // Amendment R6 (Payroll Phase 4-1, owner-approved 2026-08-08): added `page`,
  // flipped `navigable` to true — the vendor-dashboard `/dashboard/payroll` route
  // now exists, so the "future frontend phase adds `payroll:page`" note above is
  // resolved. Page Registry row added in page-registry.ts.
  // `view_all` is the only self-view-adjacent key: viewing one's OWN payroll/ledger
  // needs no permission at all (enforced in code, not RBAC — every role can see
  // their own record); `view_all` gates seeing every OTHER employee's records too,
  // and is intentionally granted to NO default preset (override-only) — see presets.ts.
  payroll: {
    label: 'Payroll',
    navigable: true,
    actions: [
      'page',
      'view_all',
      'ledger_create',
      'ledger_approve',
      'ledger_void',
      'ledger_reverse',
      'ledger_correct',
      'salary_structure_manage',
      'period_generate',
      'entry_approve',
      'period_lock',
      'period_unlock',
      'settlement_record',
    ],
  },
  // Amendment R5 (Crew Cash Phase 3, owner-approved 2026-08-07): new resource — see
  // docs/rbac-permission-catalog.md §28 for the full amendment note.
  // Non-navigable, same reasoning as `payroll` above: Crew Cash Distribution is
  // recorded from a card on the existing Daily Sheet detail page, not a dedicated
  // `/dashboard/crew-cash` route, so there is nothing for a `:page` permission to
  // gate. `edit`/`delete` are additionally allowed for the entry's own creator as a
  // code-level check even without the permission (mirrors `payroll:ledger_void`'s
  // "creator OR permission" precedent) — see CrewCashDistributionService. Unlike
  // `payroll:view_all` (override-only, granted to no default preset), `view_all`
  // here IS a flat STAFF/VENDOR_ADMIN default per the planning doc's §11 table
  // ("View all (vendor-wide) | crew-cash:view-all | STAFF, VENDOR_ADMIN") — that
  // row is worded the same flat way as every other row in that table, unlike the
  // Payroll Doc's distinctly-worded override-only `view_all` row.
  crew_cash: {
    label: 'Crew Cash Distribution',
    navigable: false,
    actions: ['create', 'edit', 'delete', 'approve', 'view_all'],
  },
  // Amendment R7 (Fleet Operations & Vehicle Intelligence, Phase 1, owner-approved
  // 2026-08-10): new resource — see docs/features/fleet-operations-vehicle-intelligence.md.
  // Navigable: /dashboard/fleet is a dedicated route. `record_check`/`record_fuel` are
  // deliberately separate from `update` — they're the driver-facing capture actions
  // (own-vehicle-only, code-level filter in the service, not a separate permission)
  // granted to the `driver` preset without granting drivers the `:page`/`:view` browse
  // surface, since the daily-check/fuel-log UI lives inside the Daily Sheet a driver
  // already has access to (daily_sheets:*), not a dedicated Fleet screen (plan doc §4,
  // "integrate not isolate"). `override_check` is the Staff/Admin-only acknowledgment
  // of a critical checklist failure (plan doc §6/§10 Rule 6) — never granted to drivers.
  fleet: {
    label: 'Fleet',
    navigable: true,
    actions: ['page', 'view', 'update', 'record_check', 'record_fuel', 'manage_maintenance', 'override_check'],
  },
  // Amendment R8 (Sheet Discrepancy Case, owner-approved 2026-08-18): new
  // resource — see docs/rbac-permission-catalog.md §29. Navigable:
  // /dashboard/discrepancy-cases is a dedicated review queue. No `create`
  // action — cases are exclusively system-generated inside
  // DailySheetService.closeSheet(), never user-initiated (unlike
  // damage_cases:create). `resolve` covers all three resolution outcomes
  // (CHARGED_TO_DRIVER/COMPANY_LOSS/WAIVED) as one action, not split
  // per-outcome — the user's explicit requirement is a single resolution
  // authority (STAFF + VENDOR_ADMIN) for all three, unlike damage_cases'
  // separate charge/waive/reverse permissions.
  sheet_discrepancies: {
    label: 'Sheet Discrepancies',
    navigable: true,
    actions: ['page', 'view', 'resolve'],
  },
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
