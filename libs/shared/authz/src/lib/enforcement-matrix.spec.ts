/**
 * Authorization enforcement matrix — the policy-level regression suite.
 *
 * For each system role it resolves the effective permission set (preset → resolver) and
 * asserts a representative allow/deny matrix. This is the deterministic guard against
 * future authorization drift. (HTTP/guard-level enforcement is covered by the backend
 * permissions.guard spec; role identity markers — platform/portal/public/authenticated —
 * are covered there too. CUSTOMER holds no vendor permissions and is asserted here.)
 */
import { resolveEffectivePermissions } from './resolver';
import { hasPermission } from './patterns';
import { getPresetPermissions, type RoleKey } from './presets';
import type { Permission } from './permissions';

function can(role: RoleKey) {
  const eff = new Set(resolveEffectivePermissions({ rolePermissions: getPresetPermissions(role) }));
  return (p: Permission) => hasPermission(eff, p);
}

interface Row {
  allow: Permission[];
  deny: Permission[];
}

const MATRIX: Record<RoleKey, Row> = {
  super_admin: {
    allow: ['users:delete', 'roles:update', 'payments:approve', 'daily_sheets:correct', 'settings:update', 'whatsapp:manage', 'payroll:period_lock'],
    deny: [],
  },
  vendor_admin: {
    allow: ['users:delete', 'roles:update', 'payments:approve', 'daily_sheets:correct', 'settings:update', 'whatsapp:manage', 'inventory:write_off', 'payroll:period_lock', 'payroll:view_all', 'crew_cash:approve', 'crew_cash:view_all'],
    deny: [],
  },
  manager: {
    allow: [
      'dashboard:view', 'customers:view', 'customers:view_financial', 'customers:update', 'customers:update_location',
      'customers:export', 'pricing:update', 'orders:approve', 'daily_sheets:update', 'daily_sheets:confirm_crew',
      'daily_sheets:manage_edit_locks', 'daily_sheets:export', 'daily_sheets:move_customer', 'daily_sheets:void_delivery',
      'daily_sheets:edit_closed_trip', 'daily_sheets:record_walk_in',
      'inventory:add_stock', 'damage_cases:review',
      'tracking:view', 'analytics:export', 'payroll:ledger_create',
      'payroll:salary_structure_manage', 'payroll:period_generate', 'payroll:settlement_record',
      // crew_cash:view_all IS a flat STAFF default here — unlike payroll:view_all
      // below, this resource's §11 table has no distinctly-worded override-only
      // phrasing for view_all (Amendment R5).
      'crew_cash:create', 'crew_cash:edit', 'crew_cash:delete', 'crew_cash:approve', 'crew_cash:view_all',
    ],
    deny: [
      'users:create', 'users:delete', 'customers:delete', 'payments:approve', 'transactions:adjust',
      'damage_cases:charge', 'daily_sheets:correct', 'inventory:write_off', 'inventory:adjust',
      'roles:view', 'roles:update', 'settings:update', 'audit_logs:view', 'balance_reminders:send', 'whatsapp:manage',
      'payroll:ledger_approve', 'payroll:ledger_void', 'payroll:ledger_reverse', 'payroll:ledger_correct',
      'payroll:entry_approve', 'payroll:period_lock', 'payroll:period_unlock',
      // view_all is override-only (Amendment R3) — MANAGER does not get it by default,
      // unlike ledger_create/salary_structure_manage/period_generate above.
      'payroll:view_all',
    ],
  },
  accountant: {
    allow: [
      'dashboard:view', 'payments:approve', 'payments:reject', 'transactions:record_payment', 'transactions:adjust',
      'analytics:view', 'analytics:export', 'balance_reminders:send', 'customers:view', 'customers:view_financial', 'customers:export',
    ],
    deny: ['customers:update', 'customers:delete', 'orders:approve', 'daily_sheets:update', 'users:create', 'roles:update', 'inventory:add_stock', 'payroll:view_all', 'crew_cash:create', 'crew_cash:view_all'],
  },
  support: {
    allow: ['dashboard:view', 'tickets:reply', 'orders:reject', 'customers:view', 'customers:update', 'delivery_issues:resolve'],
    deny: ['orders:approve', 'customers:view_financial', 'customers:delete', 'payments:approve', 'daily_sheets:update', 'roles:update', 'payroll:view_all', 'crew_cash:create', 'crew_cash:view_all'],
  },
  salesman: {
    allow: ['dashboard:view', 'customers:view', 'customers:create', 'customers:update', 'customers:update_location', 'orders:view', 'daily_sheets:update', 'products:view', 'crew_cash:create'],
    deny: ['customers:view_financial', 'customers:delete', 'orders:approve', 'payments:approve', 'daily_sheets:confirm_crew', 'inventory:add_stock', 'roles:update', 'payroll:view_all', 'crew_cash:approve', 'crew_cash:view_all', 'daily_sheets:move_customer', 'daily_sheets:void_delivery', 'daily_sheets:edit_closed_trip', 'daily_sheets:record_walk_in'],
  },
  loader: {
    allow: ['dashboard:view', 'inventory:view', 'inventory:add_stock', 'daily_sheets:load_out', 'daily_sheets:check_in', 'vans:view'],
    deny: ['inventory:adjust', 'inventory:write_off', 'daily_sheets:update', 'daily_sheets:generate', 'customers:create', 'payments:approve', 'payroll:view_all', 'crew_cash:create'],
  },
  driver: {
    allow: [
      'dashboard:page', 'customers:view', 'customers:create', 'customers:update_location', 'daily_sheets:update',
      'daily_sheets:load_out', 'daily_sheets:check_in', 'damage_cases:create', 'expenses:create', 'tracking:report_location',
      'crew_cash:create',
    ],
    deny: [
      'dashboard:view', 'customers:update', 'customers:view_financial', 'customers:delete', 'daily_sheets:confirm_crew',
      'daily_sheets:manage_edit_locks', 'daily_sheets:export', 'daily_sheets:correct', 'tracking:view', 'expenses:view',
      'payments:approve', 'damage_cases:review', 'roles:view', 'payroll:view_all', 'payroll:ledger_create',
      'payroll:period_lock', 'crew_cash:approve', 'crew_cash:view_all', 'daily_sheets:move_customer', 'daily_sheets:void_delivery',
      'daily_sheets:edit_closed_trip', 'daily_sheets:record_walk_in',
    ],
  },
  viewer: {
    allow: ['dashboard:view', 'customers:view', 'orders:view', 'analytics:view', 'audit_logs:view', 'roles:view', 'tracking:view', 'inventory:view'],
    deny: [
      'customers:view_financial', 'customers:create', 'customers:update', 'customers:delete', 'customers:export',
      'orders:approve', 'roles:update', 'payments:approve', 'daily_sheets:update', 'inventory:add_stock', 'users:create',
      'payroll:view_all', 'crew_cash:create', 'crew_cash:view_all',
    ],
  },
};

describe('enforcement matrix (role → permission)', () => {
  for (const role of Object.keys(MATRIX) as RoleKey[]) {
    describe(role, () => {
      const check = can(role);
      for (const p of MATRIX[role].allow) {
        it(`ALLOWS ${p}`, () => expect(check(p)).toBe(true));
      }
      for (const p of MATRIX[role].deny) {
        it(`DENIES ${p}`, () => expect(check(p)).toBe(false));
      }
    });
  }

  it('CUSTOMER identity holds no vendor permissions (portal is marker-gated)', () => {
    // Customers have roleId=null → resolver yields an empty vendor-permission set.
    const eff = resolveEffectivePermissions({ rolePermissions: [] });
    expect(eff).toEqual([]);
  });
});
