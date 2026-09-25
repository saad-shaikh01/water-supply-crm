import {
  PERMISSIONS,
  PERMISSION_SET,
  PAGE_PERMISSIONS,
  PERMISSION_CATALOG,
  RESOURCES,
  isPermission,
  splitPermission,
} from './permissions';
import { PERMISSION_GROUPS } from './permission-groups';
import { PAGE_REGISTRY, pagePermissionForPath } from './page-registry';

// These frozen counts come from docs/rbac-permission-catalog.md (frozen 2026-07-08).
// If the catalog legitimately changes, update the doc AND these numbers together.
// 123 = original frozen 120 + customers:view_financial + customers:update_location
// + daily_sheets:correct (Phase C refinements, owner-approved 2026-07-08).
// 132 = 123 + collection_policy (page, view, update) + conversations (page, view,
// create, send, acknowledge, manage_status) — RolesGuard→RequirePermissions migration
// of CollectionPolicyController/ConversationController/MessageController (2026-07-16).
// 144 = 143 + payroll:settlement_record ("Record settlement (mark paid)",
// Amendment R4, 2026-08-06) — 143 = 132 + payroll (view_all, ledger_create,
// ledger_approve, ledger_void, ledger_reverse, ledger_correct,
// salary_structure_manage, period_generate, entry_approve, period_lock,
// period_unlock) — fine-grained payroll:* RBAC replacing the interim
// @RequireRoles gate (Amendment R3, 2026-08-06). No new `:page` — payroll has
// no vendor-dashboard route yet.
// 149 = 144 + crew_cash (create, edit, delete, approve, view_all) — new
// resource for the Crew Cash Distribution extension to Payroll (Amendment
// R5, 2026-08-07). No new `:page` — same non-navigable reasoning as payroll.
// 150 = 149 + payroll:page — the vendor-dashboard `/dashboard/payroll` route
// now exists, so `payroll` flips from non-navigable to navigable (Amendment
// R6, Payroll Phase 4-1, 2026-08-08). +1 page permission too.
// NOTE: `fleet` (Amendment R7, 7 actions incl. `page`, 2026-08-10) was added
// to the catalog without updating these three constants at the time — this
// spec was silently broken (actual counts already exceeded the frozen ones)
// until this comment/values were corrected here (2026-08-18), alongside
// adding `sheet_discrepancies`. Pre-existing drift, not introduced by R8.
// 157 = 150 + fleet (page, view, update, record_check, record_fuel,
// manage_maintenance, override_check) — should have been recorded at R7.
// 160 = 157 + sheet_discrepancies (page, view, resolve) — new resource for
// the Sheet Discrepancy Case resolution flow (Amendment R8, 2026-08-18).
// Navigable (`/dashboard/discrepancy-cases`) — +1 page permission too.
// 163 = 160 + daily_sheets:{request_close, approve_close, reject_close} —
// the Daily Sheet Soft Close workflow (Amendment R9, 2026-08-18). No new
// resource, no new `:page` — `daily_sheets` was already navigable.
// 164 = 163 + daily_sheets:move_customer — split out of `update` so moving a
// customer's delivery to another van/sheet is independently grantable
// (Amendment R10, owner-requested 2026-08-20). No new resource, no new `:page`.
// 166 = 164 + transactions:{edit_payment, delete_payment} — manual edit/delete
// of a standalone PAYMENT transaction (Payment Edit/Delete feature, 2026-08-27).
// No new resource, no new `:page` — `transactions` was already navigable.
// 167 = 166 + daily_sheets:void_delivery — strike a recorded stop from the
// operational record (Void Delivery feature, owner-requested 2026-09-01).
// No new resource, no new `:page` — `daily_sheets` was already navigable.
// 168 = 167 + daily_sheets:edit_closed_trip — amend a checked-in trip's
// physical counts on an already-closed sheet (Post-Close Trip Correction
// feature, owner-requested 2026-09-02). No new resource, no new `:page`.
// 169 = 168 + daily_sheets:record_walk_in — record a delivery made off the
// route pipeline (Walk-in / Self-Pickup Delivery feature, owner-requested
// 2026-09-04). No new resource, no new `:page`.
// 170 = 169 + daily_sheets:edit_closed_expense — edit / void / add an Expense
// row on an already-closed sheet (Post-Close Expense Correction feature,
// owner-requested 2026-09-07). No new resource, no new `:page`.
// 171 = 170 + customers:force_deactivate — deactivate past the outstanding-balance
// guard, writing the remaining financialBalance off as a company loss (Customer
// Force Deactivate feature, owner-requested 2026-09-09). No new resource, no new
// `:page` — split from customers:deactivate so Salesman can hold the guarded
// deactivate without ever forcing a write-off.
// 175 = 171 + van_cash_ledger (page, view, manage, approve) — new resource for
// the Van Cash Ledger feature (owner-requested 2026-09-09): a running cash
// balance per van folding Daily Sheet cash handovers and Expense Center
// cash-outs into one timeline. Navigable (`/dashboard/cash-ledger`) — +1 page
// permission, +1 resource too.
// 178 = 175 + van_cash_ledger:{remit, remit_approve, remit_void} — the Office
// Cash Remittance feature (owner-requested 2026-09-10): the office -> owner/
// CEO/bank cash hop, folded into the same Cash Ledger timeline. No new
// resource, no new `:page` — added to the existing `van_cash_ledger` resource.
// 179 = 178 + customers:force_deactivate_bottles — push past the outstanding-
// bottle guard on a force deactivate, zeroing every non-zero BottleWallet with a
// matching ADJUSTMENT entry (Customer Force Deactivate Rev 3, owner-requested
// 2026-09-11). No new resource, no new `:page` — split from force_deactivate so a
// vendor can allow a balance write-off but still require bottles to be recovered.
// 181 = 179 + payroll:{attendance_view, attendance_mark} — Staff Attendance &
// Wage Types Phase 1 (docs/features/staff-attendance-and-wage-types.md,
// owner-approved 2026-09-11, Amendment R16). No new resource, no new `:page` —
// added to the existing `payroll` resource; an attendance screen lives under
// /dashboard/payroll and inherits `payroll:page`. (Merged onto
// force_deactivate_bottles above — both landed independently on main and
// feat/attendance-flow before this merge, 2026-09-14.)
// 186 = 181 + fuel_cards (page, view, manage, topup, topup_void) — new resource
// for the Fuel Card Wallet feature (owner-requested 2026-09-15): fuel card
// top-ups (office cash -> a specific fuel card) are their own vendor-wide
// cash-custody tier, same family as van_cash_ledger's Office Cash Remittance,
// instead of being logged as a generic Expense (which double-counted against
// the FUEL_EXPENSE FuelLog already generates when the fuel is actually used).
// Kept as its own resource rather than folded into `fleet` so Accountant can
// get `topup`/`view` without inheriting the full Fleet browse surface.
// Navigable (`/dashboard/fuel-cards`) — +1 page permission, +1 resource too.
// 189 = 186 + product_costs (view, manage) + analytics:view_margins — Product
// Cost History & COGS feature (owner-requested 2026-09-15): a new, separate
// `product_costs` resource (kept apart from `products` the same way `pricing`
// already is — cost/margin data is more sensitive than catalog metadata) plus
// one new action on the existing `analytics` resource gating the COGS/
// Gross-Profit/Net-Profit columns. `product_costs` is non-navigable — a "Cost
// History" entry point lives on the existing Products page, not a dedicated
// route — same reasoning as `crew_cash`/`van_cash_ledger`. No new `:page`, so
// FROZEN_PAGES is unchanged; +1 resource.
// 190 = 189 + customers:bottle_wallet_adjust — Bottle Wallet Adjustment feature
// (owner-requested 2026-09-15): ADMIN-only inventory correction of a customer's
// BottleWallet.balance for a product, independent of financialBalance/ledger.
// No new resource, no new `:page` — `customers` was already navigable. No
// default preset grants it explicitly; reaches vendors via the vendor_admin/
// super_admin `*` wildcard only.
// 191 = 190 + daily_sheets:reprice — Bulk Closed Delivery Repricing feature
// (owner-requested 2026-09-15): retroactive rate change on N closed deliveries
// for one customer, separate from `daily_sheets:correct` (driver-mistake fixes).
// No new resource, no new `:page` — `daily_sheets` was already navigable. No
// default preset grants it explicitly; reaches vendors via the vendor_admin/
// super_admin `*` wildcard only, same as `correct`.
// 193 = 191 + van_cash_ledger:{close_period, override_lock} — Cash Ledger redesign P4
// (accounting periods, 2026-09-18): close/reopen a PKT calendar month, and write into
// a closed month with a mandatory audited reason. No new resource, no new `:page`.
// Vendor-Admin-only — reaches vendors via the vendor_admin/super_admin `*` wildcard
// only; no preset grants them explicitly.
// 194 = 193 + van_cash_ledger:export — Cash Ledger redesign P5 (CSV / PDF export,
// 2026-09-18): financial data export. No new resource, no new `:page`. Vendor Admin
// via `*`; Manager and Accountant by preset (+ PRESET_DRIFT_BACKFILLS for existing vendors).
// 200 = 194 + customer_financial_adjustments (view, create, create_credit, transfer,
// create_restricted, void) — new resource for Customer Financial Adjustments (owner-approved
// 204 = 200 + extra_labour (page, view, create, manage) — new resource for
// Extra Labour Management (owner-approved 2026-09-22, Amendment R20). Navigable
// (`/dashboard/extra-labour`) — +1 page permission, +1 resource, +4 total permissions.
// 205 = 204 + payroll:advance_plan_manage — Advance Installments (owner-requested
// 2026-09-24, Amendment R21): create/update a StaffAdvancePlan, collect/skip a
// period's installment. No new resource, no new `:page` — added to the existing
// `payroll` resource.
// 206 = 205 + payroll:config_manage — Dual-Cutoff Payroll Flexibility
// (owner-requested 2026-09-25, Amendment R22): manage PayrollVendorConfig's
// cutoffDay/cashCutoffDay/cashWindowCategories. No new resource, no new
// `:page` — added to the existing `payroll` resource, VENDOR_ADMIN-only by
// default (reaches vendors via the `*` wildcard only, no preset grants it).
const FROZEN_TOTAL = 206;
const FROZEN_PAGES = 31;
const FROZEN_RESOURCES = 35;

describe('permission catalog (frozen contract)', () => {
  it('has the frozen totals', () => {
    expect(PERMISSIONS.length).toBe(FROZEN_TOTAL);
    expect(PAGE_PERMISSIONS.length).toBe(FROZEN_PAGES);
    expect(RESOURCES.length).toBe(FROZEN_RESOURCES);
  });

  it('has no duplicate permissions', () => {
    expect(PERMISSION_SET.size).toBe(PERMISSIONS.length);
  });

  it('every permission matches resource:action snake_case format', () => {
    const re = /^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/;
    for (const p of PERMISSIONS) expect(p).toMatch(re);
  });

  it('every navigable resource owns exactly one :page (first), non-navigable owns none', () => {
    for (const resource of RESOURCES) {
      const def = PERMISSION_CATALOG[resource];
      const pageCount = def.actions.filter((a) => a === 'page').length;
      if (def.navigable) {
        expect(pageCount).toBe(1);
        expect(def.actions[0]).toBe('page'); // page sorts first
      } else {
        expect(pageCount).toBe(0);
      }
    }
  });

  it('no action exists without its resource also having a :page (except whatsapp, crew_cash, van_cash_ledger, product_costs, customer_financial_adjustments)', () => {
    // payroll now has its own `:page` (Amendment R6) and is no longer exempt.
    // crew_cash: recorded from a card on the existing Daily Sheet detail page,
    // not a dedicated route (Amendment R5) — stays non-navigable.
    // van_cash_ledger: surfaced inside the existing Expense Center page, not a
    // dedicated route — stays non-navigable (owner-requested 2026-09-09).
    // product_costs: surfaced as a "Cost History" entry point on the existing
    // Products page, not a dedicated route — stays non-navigable
    // (owner-requested 2026-09-15).
    // customer_financial_adjustments: a "Charges & Credits" tab on the existing
    // customer detail page, not a dedicated route (owner-approved 2026-09-21).
    for (const resource of RESOURCES) {
      const def = PERMISSION_CATALOG[resource];
      if (
        resource === 'whatsapp' ||
        resource === 'crew_cash' ||
        resource === 'van_cash_ledger' ||
        resource === 'product_costs' ||
        resource === 'customer_financial_adjustments'
      )
        continue;
      expect(def.actions).toContain('page');
    }
  });

  it('isPermission accepts catalog strings and rejects unknowns', () => {
    expect(isPermission('customers:update')).toBe(true);
    expect(isPermission('orders:refund')).toBe(false); // removed in freeze
    expect(isPermission('nonsense')).toBe(false);
    expect(isPermission(42)).toBe(false);
  });

  it('splitPermission returns [resource, action]', () => {
    expect(splitPermission('daily_sheets:manage_edit_locks')).toEqual([
      'daily_sheets',
      'manage_edit_locks',
    ]);
  });
});

describe('permission groups', () => {
  it('flattens to exactly the frozen permission list', () => {
    const flfrom = PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.key));
    expect(new Set(flfrom)).toEqual(new Set(PERMISSIONS));
    expect(flfrom.length).toBe(PERMISSIONS.length);
  });

  it('marks page permissions with isPage', () => {
    for (const g of PERMISSION_GROUPS) {
      for (const p of g.permissions) {
        expect(p.isPage).toBe(p.key.endsWith(':page'));
      }
    }
  });
});

describe('page registry', () => {
  it('every registry permission is a real :page permission', () => {
    for (const route of PAGE_REGISTRY) {
      expect(isPermission(route.permission)).toBe(true);
      expect(route.permission.endsWith(':page')).toBe(true);
    }
  });

  it('resolves routes by longest-prefix match', () => {
    expect(pagePermissionForPath('/dashboard/customers')).toBe('customers:page');
    expect(pagePermissionForPath('/dashboard/customers/abc-123')).toBe('customers:page');
    expect(pagePermissionForPath('/dashboard/settings/roles')).toBe('roles:page');
    expect(pagePermissionForPath('/dashboard/warehouse/repairs')).toBe('inventory:page');
    expect(pagePermissionForPath('/dashboard/damage-report')).toBe('damage_cases:page');
  });

  it('returns null for unregistered routes (caller default-denies)', () => {
    expect(pagePermissionForPath('/dashboard/does-not-exist')).toBeNull();
    expect(pagePermissionForPath('/dashboard/settings')).toBeNull(); // no landing page yet
  });
});
