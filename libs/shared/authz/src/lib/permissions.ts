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
    // force_deactivate: deactivate a customer past the outstanding-balance guard,
    //   writing the remaining financialBalance off as a company loss (bad debt).
    //   Split from `deactivate` so a field role (Salesman) can hold the normal,
    //   guard-respecting deactivate without ever being able to force a write-off.
    // force_deactivate_bottles: additionally push past the outstanding-bottle
    //   guard — zeroes every non-zero BottleWallet with a matching ADJUSTMENT
    //   entry (company writes the physical bottles off). Separate from
    //   force_deactivate so a vendor can allow a balance write-off but still
    //   require bottles to be physically recovered (or vice-versa).
    // bottle_wallet_adjust (owner-requested 2026-09-15): correct a customer's
    //   BottleWallet.balance for a specific product to fix a miscount (theft,
    //   breakage, data-entry error) — pure inventory correction, ADMIN-only.
    //   Writes ONLY BottleWallet.balance inside one transaction; never touches
    //   financialBalance, Transaction, Payment, Expense or any Daily Sheet/
    //   Delivery record, so it cannot move any financial figure or analytics.
    //   No default preset grants it explicitly — reaches vendors only via the
    //   vendor_admin/super_admin `*` wildcard (see presets.ts).
    actions: [
      'page',
      'view',
      'view_financial',
      'create',
      'update',
      'update_location',
      'deactivate',
      'force_deactivate',
      'force_deactivate_bottles',
      'restore',
      'delete',
      'export',
      'manage_portal',
      'bottle_wallet_adjust',
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
  // Product Cost History & COGS (owner-requested 2026-09-15): kept separate from
  // `products` above for the same reason `pricing` was already split out — cost/margin
  // data is more sensitive than catalog metadata (a Salesman who can view/create
  // products in the catalog should not automatically see what the business pays the
  // plant). Non-navigable: surfaced as a "Cost History" entry point per product row on
  // the existing Products page (a dialog/drawer scoped to one product), not a dedicated
  // route — same reasoning as `crew_cash`/`van_cash_ledger` staying non-navigable. No
  // `page`/`create`/`update`/`delete` split — `manage` covers add/edit/void as one
  // grant since void is a narrow, safety-railed operation that doesn't warrant its own.
  product_costs: {
    label: 'Product Costs',
    navigable: false,
    actions: ['view', 'manage'],
  },
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
      // Post-Close Trip Correction (owner-requested 2026-09-02): amend a
      // checked-in load trip's physical counts (returned filled / collected
      // empty / damaged / leaked on van) on an ALREADY-CLOSED sheet, via a
      // dedicated endpoint that does not relax checkinLoad's isClosed guard.
      // Analogous to `void_delivery`; granted to Admin + Manager.
      'edit_closed_trip',
      // Walk-in / Self-Pickup Delivery (owner-requested 2026-09-04): record a
      // delivery made off the route pipeline (customer self-collected, or
      // another channel) — no van / odometer / load-out / trip. Granted to
      // Admin + Manager. Existing vendors get it via PRESET_DRIFT_BACKFILLS.manager.
      'record_walk_in',
      // Post-Close Expense Correction (owner-requested 2026-09-07): edit / void /
      // add an Expense row on an ALREADY-CLOSED sheet, via dedicated
      // /expenses/:id/correct, /expenses/:id/void and /expenses/closed endpoints
      // that do not relax the ordinary ExpenseService closed-sheet guard.
      // Analogous to `edit_closed_trip`; granted to Admin + Manager. Existing
      // vendors get it via PRESET_DRIFT_BACKFILLS.manager.
      'edit_closed_expense',
      // Bulk Closed Delivery Repricing (owner-requested 2026-09-15): retroactively
      // change the rate on N already-closed deliveries for one customer after a
      // management-approved rate exception (e.g. a customer refused a vendor-wide
      // rate increase). Deliberately a separate permission from `correct` — a
      // higher-blast-radius bulk operation across possibly many sheets/dates, not
      // a single driver-mistake fix. Admin-only via the super_admin/vendor_admin
      // wildcard, same as `correct` — not granted to any named preset.
      'reprice',
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
  // `view_margins` (owner-requested 2026-09-15, Product Cost History & COGS): gates the
  // COGS/Gross-Profit/Net-Profit columns and section in Financial analytics. Plain
  // `analytics:view` is unaffected — it continues to show Revenue/Expenses/the existing
  // `profitTotal`/`profitMargin` figures regardless of whether the viewer holds this.
  analytics: { label: 'Analytics', navigable: true, actions: ['page', 'view', 'export', 'view_margins'] },
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
  // Amendment R16 (Staff Attendance & Wage Types Phase 1, owner-approved
  // 2026-09-11): `attendance_view` / `attendance_mark` added to this same
  // resource (no new resource, no new `:page` — an attendance screen lives under
  // /dashboard/payroll and inherits `payroll:page`). `attendance_view` gates the
  // vendor-wide attendance grid; viewing one's OWN attendance needs no
  // permission (code-level self-scope, like `view_all`). `attendance_mark`
  // covers manual marking, incl. an ABSENT/HALF_DAY marking that posts a
  // LEAVE_UNPAID ledger entry. Default holder: Manager (+ `*` roles) — see
  // presets.ts / docs/features/staff-attendance-and-wage-types.md §3 D6.
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
      'attendance_view',
      'attendance_mark',
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
  // Van Cash Ledger (owner-requested 2026-09-09): the "cash in" counterpart to
  // the Expense Center — folds each Daily Sheet's driver->office cash-custody
  // handoff (once approved) and the Expense Center's cash-outs into one
  // chronological running balance per van. Navigable: /dashboard/cash-ledger
  // is its own dedicated page (not folded into the Expense Center page).
  // `manage` covers setting a van's opening balance; `approve` is the
  // office-side review/approval of a driver's cash handover (separate action
  // since it can also override the handed-over amount with a reason, unlike a
  // plain view/manage grant).
  //
  // Office Cash Remittance (owner-requested 2026-09-10) — the office -> owner/
  // CEO/bank cash hop, a vendor-wide event surfaced on the same page:
  //   `remit`         record a pending remittance (Accountant, Manager);
  //   `remit_approve` approve / reject / correct a pending remittance —
  //                   deliberately NOT granted to Accountant, so the person who
  //                   records a remittance cannot approve their own (Manager,
  //                   Vendor Admin);
  //   `remit_void`    void an ALREADY-APPROVED remittance — the tightest tier
  //                   (Vendor Admin only). Voiding a still-PENDING row only
  //                   needs `remit_approve` (checked in the service).
  //
  // Accounting periods (Cash Ledger redesign P4, 2026-09-18) — the ledger is
  // split into PKT calendar-month periods that an admin can lock:
  //   `close_period`  close / reopen a month and read its close-check
  //                   (Vendor Admin only by default — NOT in any preset).
  //   `override_lock` write into an already-CLOSED period anyway, with a
  //                   mandatory reason (>= 10 chars) that is audit-logged and
  //                   counted on the period (Vendor Admin only by default —
  //                   NOT in any preset).
  //
  // Cash Ledger CSV / PDF export (Cash Ledger redesign P5, 2026-09-18):
  //   `export`        download the ledger (timeline / daily summary) as a CSV or
  //                   PDF report — financial data export. Vendor Admin via `*`;
  //                   Manager and Accountant by preset.
  van_cash_ledger: {
    label: 'Van Cash Ledger',
    navigable: true,
    actions: [
      'page', 'view', 'manage', 'approve', 'remit', 'remit_approve', 'remit_void',
      'close_period', 'override_lock', 'export',
    ],
  },
  // Fuel Card Wallet (owner-requested 2026-09-15): fuel card top-ups (office
  // cash -> a specific fuel card) were previously logged as a generic Expense,
  // while the fuel actually filled into vehicles from that card ALSO generated
  // its own FUEL_EXPENSE via FuelLog — the same rupee counted twice. A top-up
  // is now its own vendor-wide cash-custody tier (same family as
  // OfficeCashRemittance) instead of an Expense. Deliberately its own resource
  // (not folded into `fleet`) so Accountant can be granted `topup`/`view`
  // without inheriting the full Fleet browse surface (`fleet:page`) it has no
  // need for. Navigable: dedicated /dashboard/fuel-cards page.
  //   `manage`      register / deactivate a fuel card (Vendor Admin, Manager).
  //   `topup`       record a top-up (Accountant, Manager).
  //   `topup_void`  void an already-recorded top-up (Vendor Admin, Manager) —
  //                 no separate approval tier exists here (owner chose
  //                 single-step entry over a second approval step), so void is
  //                 the only correction path and is kept a notch tighter than
  //                 plain `topup`.
  fuel_cards: {
    label: 'Fuel Cards',
    navigable: true,
    actions: ['page', 'view', 'manage', 'topup', 'topup_void'],
  },
  // Customer Financial Adjustments (owner-approved 2026-09-21, Amendment R19): manual,
  // non-delivery money events on a customer's account — service fees, penalties,
  // discounts/credits, balance transfers, write-offs, corrections — each posted to the
  // customer ledger as one ADJUSTMENT Transaction (see schema.prisma
  // CustomerFinancialAdjustment). Non-navigable: surfaced as a "Charges & Credits" tab
  // on the existing customer detail page, no dedicated route. Which action a given kind
  // needs is fixed in code (libs/shared/types customer-financial-adjustment.ts), so an
  // admin can grant "post charges" without also granting "reduce what a customer owes":
  //   `view`              list / read adjustment documents (title, internal note).
  //   `create`            post a CHARGE: service fee, penalty, other charge.
  //   `create_credit`     post a CREDIT: discount, goodwill credit, other credit.
  //   `transfer`          move an owed balance between two customers, and void one.
  //   `create_restricted` post a write-off or a correction (either direction).
  //   `void`              reverse a POSTED adjustment (voiding a transfer needs `transfer` too).
  // Everything except `view`/`create` reduces or rewrites what a customer owes without
  // cash coming in, so those are Vendor Admin (`*`) + Accountant only by default.
  customer_financial_adjustments: {
    label: 'Charges & Credits',
    navigable: false,
    actions: ['view', 'create', 'create_credit', 'transfer', 'create_restricted', 'void'],
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
