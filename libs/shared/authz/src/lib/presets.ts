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
 * `fleet:record_check`/`fleet:record_fuel` are Driver/Salesman recording their
 * van's daily check / fuel fill from inside the Daily Sheet they already have
 * access to — deliberately NOT granted fleet:page/fleet:view (no dedicated
 * Fleet screen for them, see the driver/salesman presets' own comments).
 * `extra_labour:create` (owner-approved 2026-09-22, Amendment R20) is Driver
 * registering a new worker inline from the Expense Form's "Pay Extra Labour"
 * picker (ExtraLabourPicker's "+ New Worker") — deliberately NOT granted
 * extra_labour:page/:view (no dedicated Extra Labour roster screen for them).
 */
export const NON_NAVIGATIONAL_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
  'tracking:report_location',
  'fleet:record_check',
  'fleet:record_fuel',
  // Fuel Card Wallet (bugfix 2026-09-22): Driver/Salesman hold this ONLY to
  // populate the card picker inside the Daily Sheet's "Log Fuel Fill"
  // dialog — same non-navigational shape as fleet:record_fuel above, no
  // dedicated Fuel Cards screen for them (fuel_cards:page not granted).
  // Manager/Accountant also hold this permission but pair it with
  // fuel_cards:page for the real dashboard page, so the invariant still
  // holds for them independent of this exemption.
  'fuel_cards:view',
  'extra_labour:create',
]);

// ── Computed presets ────────────────────────────────────────────────────────────
// Read-only: reach + read every module (all :page and :view permissions), EXCEPT the
// small denylist below. This is the first resource whose `:view` action needed to be
// excluded from the blanket read-only grant — every prior confidentiality-restricted
// resource dodged this by naming its action `view_all` instead of plain `view`
// (`payroll:view_all`, `crew_cash:view_all`), which this filter's `action === 'view'`
// check never matches. `product_costs:view` couldn't take that path (its controller
// guard is fixed to the literal string, already shipped in a concurrently-built
// backend module), so it needs an explicit exclusion instead of a naming dodge.
// Add a permission here only when it is genuinely confidentiality-sensitive enough
// that even blanket read-only access (Viewer) should not include it by default.
const READ_ONLY_EXCLUDED: Permission[] = [
  // Product Cost History & COGS (owner-requested 2026-09-15): plant cost/margin data
  // is restricted to Vendor Admin + Accountant (design doc §8) — Viewer's blanket
  // read-only grant must not silently include it just because the action is `view`.
  'product_costs:view',
  // Customer Financial Adjustments (owner-approved 2026-09-21, Amendment R19): the
  // documents carry a staff-only internal note (why a customer's balance was written
  // off / corrected) — the same tier as `customers:view_financial`, which Viewer also
  // lacks. Would otherwise leak in through the blanket `:view` grant.
  'customer_financial_adjustments:view',
];
const READ_ONLY_PERMISSIONS: Permission[] = PERMISSIONS.filter((p) => {
  const [, action] = splitPermission(p);
  return (action === 'page' || action === 'view') && !READ_ONLY_EXCLUDED.includes(p);
});

// Manager (= legacy STAFF): reconciled to the current @Roles matrix during the Phase C
// cutover (docs/rbac-phase-c-migration-plan.md §4a) so existing behavior is preserved.
// Broad operational access, but NOT destructive/financial-sensitive ops, user management,
// access control, settings, audit logs, or balance reminders (all VENDOR_ADMIN-only).
const MANAGER_PERMISSIONS: Permission[] = [
  'dashboard:page', 'dashboard:view',
  // Product Cost History & COGS (owner-requested 2026-09-15): `analytics:view_margins`
  // and `product_costs:{view,manage}` are deliberately NOT granted to Manager per the
  // design doc's §8 preset table — margin data is restricted by default (Vendor Admin
  // + Accountant only), same confidentiality tier as `payroll:view_all`.
  'analytics:page', 'analytics:view', 'analytics:export',
  // customers:export → STAFF currently downloads monthly statements (customers:export).
  // view_financial + update_location: STAFF sees financial summaries and pins GPS.
  'customers:page', 'customers:view', 'customers:view_financial', 'customers:create',
  'customers:update', 'customers:update_location', 'customers:export',
  'pricing:page', 'pricing:view', 'pricing:update',
  'daily_sheets:page', 'daily_sheets:view', 'daily_sheets:generate', 'daily_sheets:update',
  'daily_sheets:load_out', 'daily_sheets:check_in', 'daily_sheets:close', 'daily_sheets:confirm_crew',
  'daily_sheets:swap_assignment', 'daily_sheets:bulk_import', 'daily_sheets:manage_edit_locks', 'daily_sheets:export',
  // Move Customer (Amendment R10): split out of `update` so it's independently
  // grantable — Manager keeps it by default (preserves pre-R10 behavior, which
  // rode along with `update`); Driver/Salesman do NOT get it by default anymore
  // and must be granted it explicitly per-vendor if that vendor wants field
  // roles moving customers between vans themselves.
  'daily_sheets:move_customer',
  // Soft Close (Amendment R9): Manager reviews a driver/salesman's self-close
  // request — same tier as the existing direct `close` above.
  'daily_sheets:approve_close', 'daily_sheets:reject_close',
  // Void Delivery (owner-requested 2026-09-01): Admin + Manager may strike a
  // recorded stop from the operational record (reverses ledger for COMPLETED/
  // EMPTY_ONLY). Existing vendors get it via PRESET_DRIFT_BACKFILLS.manager.
  'daily_sheets:void_delivery',
  // Post-Close Trip Correction (owner-requested 2026-09-02): Admin + Manager may
  // amend a checked-in trip's physical counts on a closed sheet. Existing
  // vendors get it via PRESET_DRIFT_BACKFILLS.manager.
  'daily_sheets:edit_closed_trip',
  // Walk-in / Self-Pickup Delivery (owner-requested 2026-09-04): Admin + Manager
  // may record a delivery made off the route pipeline. Existing vendors get it
  // via PRESET_DRIFT_BACKFILLS.manager.
  'daily_sheets:record_walk_in',
  // Post-Close Expense Correction (owner-requested 2026-09-07): Admin + Manager
  // may edit / void / add an Expense row on an already-closed sheet. Existing
  // vendors get it via PRESET_DRIFT_BACKFILLS.manager.
  'daily_sheets:edit_closed_expense',
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
  'transactions:edit_payment', 'transactions:delete_payment',
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
  // Advance Installments (Amendment R21, owner-requested 2026-09-24): same flat
  // VENDOR_ADMIN + STAFF default tier as the four actions above. Existing vendors
  // get it via PRESET_DRIFT_BACKFILLS.manager.
  'payroll:advance_plan_manage',
  // Staff Attendance & Wage Types Phase 1 (Amendment R16,
  // docs/features/staff-attendance-and-wage-types.md §3 D6): Manager records
  // and reviews attendance. Existing vendors get these via
  // PRESET_DRIFT_BACKFILLS.manager.
  'payroll:attendance_view', 'payroll:attendance_mark',
  // Crew Cash Distribution (Amendment R5, crew-operational-cash-distribution.md §11):
  // all five actions are flat STAFF/VENDOR_ADMIN defaults — including view_all, which
  // (unlike payroll:view_all above) is NOT override-only for this resource; §11's table
  // words every row the same flat way, with no distinctly-worded override-only phrasing
  // for view_all here. edit/delete are additionally available to the entry's own
  // creator regardless of role, as a code-level check inside the service.
  'crew_cash:create', 'crew_cash:edit', 'crew_cash:delete', 'crew_cash:approve', 'crew_cash:view_all',
  // Fleet Operations & Vehicle Intelligence (Amendment R7, plan doc §7.12): Manager
  // (=STAFF) gets the full operational set — the plan's own RBAC table grants STAFF
  // everything except being outright excluded, same tier as vans:* above.
  'fleet:page', 'fleet:view', 'fleet:update', 'fleet:record_check', 'fleet:record_fuel',
  'fleet:manage_maintenance', 'fleet:override_check',
  // Sheet Discrepancy Case (Amendment R8): flat STAFF/VENDOR_ADMIN default —
  // the user's explicit requirement was STAFF + VENDOR_ADMIN resolution
  // authority, no override-only tier the way payroll:view_all has.
  'sheet_discrepancies:page', 'sheet_discrepancies:view', 'sheet_discrepancies:resolve',
  // Van Cash Ledger (owner-requested 2026-09-09): Manager sees the dedicated
  // page and may approve a pending cash handover — the "Manager/Accountant
  // tier and up" cohort the feature spec calls for. `van_cash_ledger:manage`
  // (setting a van's opening balance) is deliberately VENDOR_ADMIN-only — NOT
  // granted here. Existing vendors get these via PRESET_DRIFT_BACKFILLS.manager.
  'van_cash_ledger:page', 'van_cash_ledger:view', 'van_cash_ledger:approve',
  // Office Cash Remittance (owner-requested 2026-09-10): Manager may record AND
  // approve an office -> owner/bank handover. `remit_void` (voiding an
  // already-approved remittance) stays VENDOR_ADMIN-only — NOT granted here.
  'van_cash_ledger:remit', 'van_cash_ledger:remit_approve',
  // Cash Ledger export (P5, 2026-09-18): Manager may download the ledger as CSV / PDF.
  'van_cash_ledger:export',
  // Fuel Card Wallet (owner-requested 2026-09-15): Manager gets the full set,
  // including `topup_void` — there's no separate approval tier for this
  // feature (single-step entry), so Manager is the practical "fix a mistake"
  // authority alongside Vendor Admin.
  'fuel_cards:page', 'fuel_cards:view', 'fuel_cards:manage', 'fuel_cards:topup', 'fuel_cards:topup_void',
  // Extra Labour (owner-approved 2026-09-22, Amendment R20)
  'extra_labour:page', 'extra_labour:view', 'extra_labour:create', 'extra_labour:manage',
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
      'transactions:edit_payment',
      'transactions:delete_payment',
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
      // Van Cash Ledger (owner-requested 2026-09-09): Accountant is one of the
      // named "Manager/Accountant/Admin" approve-tier roles. Not `:manage`
      // (opening balances stay VENDOR_ADMIN-only).
      'van_cash_ledger:view',
      'van_cash_ledger:approve',
      // Office Cash Remittance (owner-requested 2026-09-10): Accountant may
      // RECORD an office -> owner/bank handover but NOT approve it — segregation
      // of duties (the recorder cannot approve their own remittance).
      'van_cash_ledger:remit',
      // Cash Ledger export (P5, 2026-09-18): Accountant may download the ledger as CSV / PDF.
      'van_cash_ledger:export',
      // Fuel Card Wallet (owner-requested 2026-09-15): Accountant is the
      // day-to-day person recording fuel card top-ups, and needs to see the
      // resulting card balances — but not `manage` (registering/deactivating
      // cards) or `topup_void` (voiding a past entry), which stay Manager/
      // Vendor Admin.
      'fuel_cards:page',
      'fuel_cards:view',
      'fuel_cards:topup',
      // Product Cost History & COGS (owner-requested 2026-09-15): Accountant already
      // handles financial reconciliation elsewhere in this codebase (e.g.
      // BOTTLE_PURCHASED expense entry) and gets full access here per the design
      // doc's §8 preset table — same trusted-financial tier as Vendor Admin, unlike
      // Manager which is deliberately excluded. Existing vendors get these via
      // PRESET_DRIFT_BACKFILLS.accountant.
      'product_costs:view',
      'product_costs:manage',
      'analytics:view_margins',
      // Customer Financial Adjustments (owner-approved 2026-09-21, Amendment R19):
      // Accountant already holds `transactions:adjust` (the legacy manual-adjustment
      // path), so it gets the full set here — Vendor Admin via `*`. Manager
      // deliberately gets NONE (it does not hold `transactions:adjust` either, and
      // the enforcement matrix denies it). Existing vendors get these via
      // PRESET_DRIFT_BACKFILLS.accountant.
      'customer_financial_adjustments:view',
      'customer_financial_adjustments:create',
      'customer_financial_adjustments:create_credit',
      'customer_financial_adjustments:transfer',
      'customer_financial_adjustments:create_restricted',
      'customer_financial_adjustments:void',
      // Extra Labour (owner-approved 2026-09-22, Amendment R20)
      'extra_labour:page',
      'extra_labour:view',
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
      // Deactivate / Restore (owner-requested 2026-09-09): the field Salesman
      // closes out customer accounts on the route. The guarded `deactivate`
      // still refuses any customer with pending deliveries, outstanding
      // bottles, OR an outstanding financial balance — only a holder of the
      // separate `customers:force_deactivate` (VENDOR_ADMIN only by default)
      // can push past the balance guard and write the remainder off as a
      // company loss. Existing vendors get these via PRESET_DRIFT_BACKFILLS.salesman.
      'customers:deactivate',
      'customers:restore',
      'orders:page',
      'orders:view',
      'daily_sheets:page',
      'daily_sheets:view',
      'daily_sheets:update',
      // NOT daily_sheets:move_customer (Amendment R10) — moving a customer
      // between vans/sheets used to ride along with `update`; it's now a
      // separate, independently-grantable action, off by default for field
      // roles unless a vendor explicitly opts in.
      // Soft Close (Amendment R9): salesman may close their own sheet, same
      // as Driver above.
      'daily_sheets:request_close',
      'products:page',
      'products:view',
      // Crew Cash Distribution create (Amendment R5, §11: "SALESMAN (primary
      // user today)") — the Salesman is on the route recording tea/meal/cash
      // handed to crew, so this is a default grant, not an override.
      'crew_cash:create',
      // Fleet Operations (Amendment R7, plan doc §7.12): Salesman rides the
      // same van as Driver and is equally able to record the daily vehicle
      // check / fuel fills from inside the Daily Sheet — same grant as
      // Driver below, same NOT-granted exclusions (no fleet:page/fleet:view,
      // no fleet:override_check).
      'fleet:record_check',
      'fleet:record_fuel',
      // Communication Center (owner-requested 2026-09-15): Salesman now drives
      // their own route (S43 parity) and needs the exact same conversation
      // access as Driver below — read/send/acknowledge instruction messages,
      // both from the embedded Daily Sheet thread and the standalone
      // Communications inbox.
      'conversations:page',
      'conversations:view',
      'conversations:create',
      'conversations:send',
      'conversations:acknowledge',
      // Fuel Card Wallet (bugfix 2026-09-22): same rationale as Driver above —
      // Salesman logs fuel fills from the same Daily Sheet dialog and needs
      // `view` for the card picker to populate.
      'fuel_cards:view',
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
      // NOT daily_sheets:move_customer (Amendment R10) — split out of `update`,
      // off by default for Driver; grant it per-role from Roles & Access if a
      // vendor wants drivers moving customers between vans themselves.
      'daily_sheets:load_out',
      'daily_sheets:check_in',
      // Soft Close (Amendment R9): driver may close their own sheet — Staff/
      // Admin then approves or rejects it (daily_sheets:approve_close /
      // :reject_close, Manager preset above; not granted to Driver).
      'daily_sheets:request_close',
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
      // Fleet Operations (Amendment R7, plan doc §7.12): driver records their own
      // vehicle's daily check + fuel fills from inside the Daily Sheet they already
      // have access to — deliberately NOT granted fleet:page/fleet:view (no dedicated
      // Fleet screen for drivers) or fleet:override_check (Staff/Admin-only).
      'fleet:record_check',
      'fleet:record_fuel',
      // Fuel Card Wallet (bugfix 2026-09-22): driver logs fuel fills straight
      // from the Daily Sheet's "Log Fuel Fill" dialog, which needs `view` to
      // fetch the card list for its "pay from this card" picker. Without it
      // the dropdown silently renders empty, the fill never gets a
      // fuelCardId, and the card's own balance never draws down even though
      // the driver marked it as card-paid. NOT `fuel_cards:page` — no
      // dedicated Fuel Cards screen for drivers, same non-grant pattern as
      // fleet:page above.
      'fuel_cards:view',
      // Extra Labour (owner-approved 2026-09-22, Amendment R20)
      'extra_labour:create',
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

/**
 * Legacy `User.role` enum → new system `RoleKey`. Shared by the RBAC backfill
 * seed and by user creation, so a freshly created user is assigned the matching
 * `Role` row (and therefore its permissions) the same way a backfilled/seeded
 * user is — not just the legacy enum value, which the permission resolver never
 * reads directly. CUSTOMER stays unassigned (portal-only, no dashboard RBAC).
 */
export const LEGACY_ROLE_TO_KEY: Record<string, RoleKey | null> = {
  SUPER_ADMIN: 'super_admin',
  VENDOR_ADMIN: 'vendor_admin',
  STAFF: 'manager',
  DRIVER: 'driver',
  SALESMAN: 'salesman',
  LOADER: 'loader',
  CUSTOMER: null,
};
