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
const FROZEN_TOTAL = 150;
const FROZEN_PAGES = 26;
const FROZEN_RESOURCES = 28;

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

  it('no action exists without its resource also having a :page (except whatsapp, crew_cash)', () => {
    // payroll now has its own `:page` (Amendment R6) and is no longer exempt.
    // crew_cash: recorded from a card on the existing Daily Sheet detail page,
    // not a dedicated route (Amendment R5) — stays non-navigable.
    for (const resource of RESOURCES) {
      const def = PERMISSION_CATALOG[resource];
      if (resource === 'whatsapp' || resource === 'crew_cash') continue;
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
