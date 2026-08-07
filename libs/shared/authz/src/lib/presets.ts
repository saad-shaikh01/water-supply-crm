/**
 * ROLE PRESETS — the default permission bundle for each system role. Mirrors the
 * approved rbac-design.md §6 (corrected during the 2026-07-08 verification pass so
 * every string is valid against the frozen catalog).
 *
 * Presets are the seed + "reset to preset" source. After seeding, a vendor may edit
 * any role freely; presets are never re-applied silently.
 *
 * Grants may be wildcards: `super_admin`/`vendor_admin` seed a single `*` (one row,
 * future-proof). `manager`/`viewer` are computed from the catalog by exclusion/filter.
 * The remaining field roles are enumerated explicitly.
 */
import { PERMISSIONS, splitPermission, type Permission } from './permissions';
import type { PermissionPattern } from './patterns';

export type RoleKey =
  | 'super_admin'
  | 'vendor_admin'
  | 'manager'
  | 'accountant'
  | 'support'
  | 'salesman'
  | 'loader'
  | 'driver'
  | 'viewer';

export type RoleCategory =
  | 'platform'
  | 'admin'
  | 'finance'
  | 'customer_support'
  | 'field'
  | 'read_only';

export interface RolePreset {
  key: RoleKey;
  name: string;
  description: string;
  category: RoleCategory;
  /** Default grants for this role (exact permissions and/or wildcards). */
  permissions: PermissionPattern[];
}

export const SYSTEM_ROLE_KEYS: readonly RoleKey[] = [
  'super_admin',
  'vendor_admin',
  'manager',
  'accountant',
  'support',
  'salesman',
  'loader',
  'driver',
  'viewer',
];

/**
 * Actions that are NOT reached through a page (device/background capabilities), so
 * they are exempt from the "no action without its `:page`" invariant.
 * `tracking:report_location` is the driver app posting its own GPS position.
 */
export const NON_NAVIGATIONAL_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
  'tracking:report_location',
]);

// ── Computed presets ────────────────────────────────────────────────────────────
// Read-only: reach + read every module (all :page and :view permissions).
const READ_ONLY_PERMISSIONS: Permission[] = PERMISSIONS.filter((p) => {
  const [, action] = splitPermission(p);
  return action === 'page' || action === 'view';
});

// Manager (= legacy STAFF): reconciled to the current @Roles matrix during the Phase C
// cutover (docs/rbac-phase-c-migration-plan.md §4a) so existing behavior is preserved.
// Broad operational access, but NOT destructive/financial-sensitive ops, user management,
// access control, settings, audit logs, or balance reminders (all VENDOR_ADMIN-only).
const MANAGER_PERMISSIONS: Permission[] = [
  'dashboard:page', 'dashboard:view',
  'analytics:page', 'analytics:view', 'analytics:export',
  // customers:export → STAFF currently downloads monthly statements (customers:export).
  // view_financial + update_location: STAFF sees financial summaries and pins GPS.
  'customers:page', 'customers:view', 'customers:view_financial', 'customers:create',
  'customers:update', 'customers:update_location', 'customers:export',
  'pricing:page', 'pricing:view', 'pricing:update',
  'daily_sheets:page', 'daily_sheets:view', 'daily_sheets:generate', 'daily_sheets:update',
  'daily_sheets:load_out', 'daily_sheets:check_in', 'daily_sheets:close', 'daily_sheets:confirm_crew',
  'daily_sheets:swap_assignment', 'daily_sheets:bulk_import', 'daily_sheets:manage_edit_locks', 'daily_sheets:export',
  'damage_cases:page', 'damage_cases:view', 'damage_cases:create', 'damage_cases:update', 'damage_cases:review',
  'delivery_issues:page', 'delivery_issues:view', 'delivery_issues:plan', 'delivery_issues:resolve',
  'expenses:page', 'expenses:view', 'expenses:create', 'expenses:update',
  'orders:page', 'orders:view', 'orders:approve', 'orders:reject', 'orders:dispatch',
  'payments:page', 'payments:view',
  'products:page', 'products:view', 'products:create', 'products:update',
  'routes:page', 'routes:view', 'routes:create', 'routes:update',
  'tickets:page', 'tickets:view', 'tickets:reply',
  'tracking:page', 'tracking:view', 'tracking:report_location',
  'transactions:page', 'transactions:view', 'transactions:record_payment',
  'users:page', 'users:view',
  'vans:page', 'vans:view', 'vans:create', 'vans:update', 'vans:manage_crew',
  'inventory:page', 'inventory:view', 'inventory:add_stock', 'inventory:mark_damaged', 'inventory:manage_repairs',
  'notifications:page', 'notifications:view',
  'collection_policy:page', 'collection_policy:view',
  'conversations:page', 'conversations:view', 'conversations:create', 'conversations:send',
  'conversations:acknowledge', 'conversations:manage_status',
  // Payroll (§10 default holders): "Log advance/expense/bonus/adjustment", "Manage
  // salary structures (create)", and "Generate/regenerate payroll draft" are all
  // VENDOR_ADMIN + STAFF by default. Approve/void/reverse/correct/lock/unlock and
  // viewing OTHER employees' payroll (view_all) stay VENDOR_ADMIN-only by default —
  // STAFF can only be granted those via an explicit UserPermissionOverride (per §10's
  // distinctly-worded row for view_all, "VENDOR_ADMIN, STAFF (if given the
  // permission)" — read as override-only, unlike every other row's flat grant — and
  // per §10's "STAFF only via UserPermissionOverride" note on ledger_approve), never
  // through this preset.
  // settlement_record ("Record settlement (mark paid)", §10) is the same flat
  // VENDOR_ADMIN + STAFF default as the three above — Amendment R4.
  // page (Amendment R6, Payroll Phase 4-1): flat VENDOR_ADMIN + STAFF default, same
  // tier as ledger_create/salary_structure_manage/period_generate/settlement_record
  // above — Manager needs the sidebar entry to actually reach any of those actions.
  'payroll:page',
  'payroll:ledger_create', 'payroll:salary_structure_manage', 'payroll:period_generate',
  'payroll:settlement_record',
  // Crew Cash Distribution (Amendment R5, crew-operational-cash-distribution.md §11):
  // all five actions are flat STAFF/VENDOR_ADMIN defaults — including view_all, which
  // (unlike payroll:view_all above) is NOT override-only for this resource; §11's table
  // words every row the same flat way, with no distinctly-worded override-only phrasing
  // for view_all here. edit/delete are additionally available to the entry's own
  // creator regardless of role, as a code-level check inside the service.
  'crew_cash:create', 'crew_cash:edit', 'crew_cash:delete', 'crew_cash:approve', 'crew_cash:view_all',
];

export const ROLE_PRESETS: Record<RoleKey, RolePreset> = {
  super_admin: {
    key: 'super_admin',
    name: 'Super Admin',
    description: 'Full platform access across all vendors.',
    category: 'platform',
    permissions: ['*'],
  },
  vendor_admin: {
    key: 'vendor_admin',
    name: 'Vendor Admin',
    description: 'Full access within the vendor.',
    category: 'admin',
    permissions: ['*'],
  },
  manager: {
    key: 'manager',
    name: 'Manager',
    description:
      'Broad operational and financial access. Cannot manage access control, delete users, or change vendor settings.',
    category: 'admin',
    permissions: MANAGER_PERMISSIONS,
  },
  accountant: {
    key: 'accountant',
    name: 'Accountant',
    description: 'Finance: payments, transactions, analytics, and balance reminders.',
    category: 'finance',
    permissions: [
      'dashboard:page',
      'dashboard:view',
      'payments:page',
      'payments:view',
      'payments:approve',
      'payments:reject',
      'transactions:page',
      'transactions:view',
      'transactions:record_payment',
      'transactions:adjust',
      'analytics:page',
      'analytics:view',
      'analytics:export',
      'balance_reminders:page',
      'balance_reminders:view',
      'balance_reminders:send',
      'balance_reminders:configure',
      'customers:page',
      'customers:view',
      'customers:view_financial',
      'customers:export',
    ],
  },
  support: {
    key: 'support',
    name: 'Support',
    description: 'Customer support: tickets, delivery issues, and order/customer follow-up.',
    category: 'customer_support',
    permissions: [
      'dashboard:page',
      'dashboard:view',
      'tickets:page',
      'tickets:view',
      'tickets:reply',
      'orders:page',
      'orders:view',
      'orders:reject',
      'customers:page',
      'customers:view',
      'customers:update',
      'delivery_issues:page',
      'delivery_issues:view',
      'delivery_issues:plan',
      'delivery_issues:resolve',
    ],
  },
  salesman: {
    key: 'salesman',
    name: 'Salesman',
    description: 'Field sales: manage customers and record deliveries/orders.',
    category: 'field',
    permissions: [
      'dashboard:page',
      'dashboard:view',
      'customers:page',
      'customers:view',
      'customers:create',
      'customers:update',
      'customers:update_location',
      'orders:page',
      'orders:view',
      'daily_sheets:page',
      'daily_sheets:view',
      'daily_sheets:update',
      'products:page',
      'products:view',
      // Crew Cash Distribution create (Amendment R5, §11: "SALESMAN (primary
      // user today)") — the Salesman is on the route recording tea/meal/cash
      // handed to crew, so this is a default grant, not an override.
      'crew_cash:create',
    ],
  },
  loader: {
    key: 'loader',
    name: 'Loader',
    description: 'Warehouse loading and van load-out / check-in.',
    category: 'field',
    permissions: [
      'dashboard:page',
      'dashboard:view',
      'inventory:page',
      'inventory:view',
      'inventory:add_stock',
      'daily_sheets:page',
      'daily_sheets:view',
      'daily_sheets:load_out',
      'daily_sheets:check_in',
      'vans:page',
      'vans:view',
    ],
  },
  driver: {
    key: 'driver',
    name: 'Driver',
    description: 'Delivery execution, customer updates, location reporting, and damage reports.',
    category: 'field',
    // Reconciled to the current DRIVER @Roles matrix (Phase C §4b): no crew confirmation
    // (that is ADMIN/STAFF), but can create/update customers, log expenses, and edit deliveries.
    permissions: [
      // dashboard:page only (opens the driver /home route); NOT dashboard:view — the
      // admin overview data endpoints stay VENDOR_ADMIN/STAFF. Driver home data comes
      // from daily_sheets:view (driver stats endpoint).
      'dashboard:page',
      'customers:page',
      'customers:view',
      'customers:create',
      // GPS pinning only — NOT general customer editing, NOT financial summaries.
      'customers:update_location',
      // Driver delivery execution: submit deliveries, manage load trips, request edits +
      // ack notes (via :update). NOT unlock-edit (staff, :manage_edit_locks) and NOT
      // full-sheet export (staff, :export) — invoice/receipt are reads under :view.
      'daily_sheets:page',
      'daily_sheets:view',
      'daily_sheets:update',
      'daily_sheets:load_out',
      'daily_sheets:check_in',
      'damage_cases:page',
      'damage_cases:view',
      'damage_cases:create',
      'damage_cases:update',
      'expenses:page',
      'expenses:create',
      'tracking:report_location',
      'conversations:page',
      'conversations:view',
      'conversations:create',
      'conversations:send',
      'conversations:acknowledge',
      // Crew Cash Distribution create (Amendment R5, §11: "DRIVER" is listed
      // alongside SALESMAN/STAFF/VENDOR_ADMIN as a default holder).
      'crew_cash:create',
    ],
  },
  viewer: {
    key: 'viewer',
    name: 'Viewer',
    description: 'Read-only access: can open and read every module, no changes.',
    category: 'read_only',
    permissions: READ_ONLY_PERMISSIONS,
  },
};

/** The default grant patterns for a system role (as stored on seed). */
export function getPresetPermissions(key: RoleKey): PermissionPattern[] {
  return [...ROLE_PRESETS[key].permissions];
}
