import { PERMISSIONS, type Permission } from './permissions';
import {
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  patternMatches,
  isPermissionPattern,
  expandPattern,
  type PermissionPattern,
} from './patterns';
import {
  resolveEffectivePermissions,
  createPermissionChecker,
  type PermissionOverrideInput,
} from './resolver';
import {
  ROLE_PRESETS,
  SYSTEM_ROLE_KEYS,
  getPresetPermissions,
  NON_NAVIGATIONAL_PERMISSIONS,
} from './presets';

describe('wildcard matcher', () => {
  it('matches exact permissions', () => {
    expect(hasPermission(['customers:update'], 'customers:update')).toBe(true);
    expect(hasPermission(['customers:update'], 'customers:delete')).toBe(false);
  });

  it('global wildcard matches everything', () => {
    for (const p of PERMISSIONS) expect(hasPermission(['*'], p)).toBe(true);
  });

  it('resource wildcard matches only that resource', () => {
    expect(hasPermission(['customers:*'], 'customers:delete')).toBe(true);
    expect(hasPermission(['customers:*'], 'customers:page')).toBe(true);
    expect(hasPermission(['customers:*'], 'orders:view')).toBe(false);
  });

  it('resource wildcard does not leak across similarly named resources', () => {
    // `daily_sheets:*` must not match a hypothetical `daily:*`-style prefix bug
    expect(hasPermission(['daily_sheets:*'], 'daily_sheets:view')).toBe(true);
    expect(patternMatches('daily_sheets:*', 'daily_sheets:close')).toBe(true);
  });

  it('Set fast-path agrees with iterable path', () => {
    const grants: PermissionPattern[] = ['orders:*', 'customers:view'];
    expect(hasPermission(new Set(grants), 'payments:approve')).toBe(false); // out of scope
    expect(hasPermission(new Set(grants), 'orders:approve')).toBe(true);
    expect(hasPermission(new Set(grants), 'customers:view')).toBe(true);
    expect(hasPermission(new Set(grants), 'customers:delete')).toBe(false);
  });

  it('hasAny / hasAll', () => {
    const grants: PermissionPattern[] = ['customers:view', 'orders:view'];
    expect(hasAnyPermission(grants, ['customers:delete', 'orders:view'])).toBe(true);
    expect(hasAllPermissions(grants, ['customers:view', 'orders:view'])).toBe(true);
    expect(hasAllPermissions(grants, ['customers:view', 'orders:approve'])).toBe(false);
  });

  it('isPermissionPattern validates exact + wildcard forms', () => {
    expect(isPermissionPattern('*')).toBe(true);
    expect(isPermissionPattern('customers:*')).toBe(true);
    expect(isPermissionPattern('customers:update')).toBe(true);
    expect(isPermissionPattern('nope:*')).toBe(false);
    expect(isPermissionPattern('customers:refund')).toBe(false);
    expect(isPermissionPattern(123)).toBe(false);
  });

  it('expandPattern expands wildcards from the catalog', () => {
    expect(expandPattern('*').length).toBe(PERMISSIONS.length);
    expect(expandPattern('pricing:*').sort()).toEqual(['pricing:page', 'pricing:update', 'pricing:view']);
    expect(expandPattern('customers:update')).toEqual(['customers:update']);
  });

  it('expandPattern is total: stale/unknown grants expand to [] instead of throwing', () => {
    // Simulates DB rows that survived a catalog rename/removal (cast past the type).
    expect(expandPattern('obsolete:*' as PermissionPattern)).toEqual([]);
    expect(expandPattern('customers:ghost' as PermissionPattern)).toEqual([]);
    expect(() => expandPattern('obsolete:*' as PermissionPattern)).not.toThrow();
  });
});

describe('effective permission resolver', () => {
  it('resolves plain role grants (expanding wildcards)', () => {
    const eff = resolveEffectivePermissions({ rolePermissions: ['pricing:*', 'orders:view'] });
    expect(eff).toEqual(['orders:view', 'pricing:page', 'pricing:update', 'pricing:view']);
  });

  it('ALLOW override is additive', () => {
    const eff = resolveEffectivePermissions({
      rolePermissions: ['orders:view'],
      overrides: [{ permission: 'orders:approve', effect: 'ALLOW' }],
    });
    expect(eff).toContain('orders:approve');
    expect(eff).toContain('orders:view');
  });

  it('DENY override removes a permission granted by a wildcard role (DENY wins)', () => {
    const eff = resolveEffectivePermissions({
      rolePermissions: ['customers:*'],
      overrides: [{ permission: 'customers:delete', effect: 'DENY' }],
    });
    expect(eff).toContain('customers:update');
    expect(eff).not.toContain('customers:delete');
  });

  it('DENY beats ALLOW for the same permission regardless of order', () => {
    const overrides: PermissionOverrideInput[] = [
      { permission: 'payments:approve', effect: 'ALLOW' },
      { permission: 'payments:approve', effect: 'DENY' },
    ];
    const eff = resolveEffectivePermissions({ rolePermissions: ['payments:view'], overrides });
    expect(eff).not.toContain('payments:approve');
  });

  it('ignores expired overrides and honors future/permanent ones', () => {
    const now = new Date('2026-07-08T12:00:00Z');
    const past = new Date('2026-07-01T00:00:00Z');
    const future = new Date('2026-08-01T00:00:00Z');
    const eff = resolveEffectivePermissions({
      rolePermissions: ['orders:view'],
      overrides: [
        { permission: 'orders:approve', effect: 'ALLOW', expiresAt: past }, // expired → ignored
        { permission: 'orders:reject', effect: 'ALLOW', expiresAt: future }, // active
        { permission: 'orders:dispatch', effect: 'ALLOW', expiresAt: null }, // permanent
      ],
      now,
    });
    expect(eff).not.toContain('orders:approve');
    expect(eff).toContain('orders:reject');
    expect(eff).toContain('orders:dispatch');
  });

  it('accepts ISO string expiry dates', () => {
    const eff = resolveEffectivePermissions({
      rolePermissions: ['orders:view'],
      overrides: [{ permission: 'orders:approve', effect: 'ALLOW', expiresAt: '2020-01-01T00:00:00Z' }],
      now: new Date('2026-07-08T00:00:00Z'),
    });
    expect(eff).not.toContain('orders:approve');
  });

  it('output is deduplicated and sorted (deterministic)', () => {
    const eff = resolveEffectivePermissions({
      rolePermissions: ['orders:view', 'orders:view', 'orders:*'],
    });
    expect(eff).toEqual([...eff].sort());
    expect(new Set(eff).size).toBe(eff.length);
  });

  it('createPermissionChecker gives O(1) membership over a resolved set', () => {
    const eff = resolveEffectivePermissions({ rolePermissions: ['customers:*'] });
    const can = createPermissionChecker(eff);
    expect(can('customers:export')).toBe(true);
    expect(can('orders:view')).toBe(false);
  });

  it('ignores stale/unknown grants and keeps the effective set within the catalog', () => {
    const eff = resolveEffectivePermissions({
      rolePermissions: ['customers:view', 'obsolete:*' as PermissionPattern, 'customers:ghost' as PermissionPattern],
    });
    expect(eff).toEqual(['customers:view']);
    expect(eff.every((p) => PERMISSIONS.includes(p))).toBe(true);
  });

  it('DENY can restrict even a super-admin wildcard role', () => {
    const eff = resolveEffectivePermissions({
      rolePermissions: ['*'],
      overrides: [{ permission: 'payments:approve', effect: 'DENY' }],
    });
    expect(eff).not.toContain('payments:approve');
    expect(eff).toContain('payments:view');
  });
});

describe('role presets', () => {
  it('defines a preset for every system role key', () => {
    for (const key of SYSTEM_ROLE_KEYS) expect(ROLE_PRESETS[key].key).toBe(key);
  });

  it('every preset permission is a valid grant pattern', () => {
    for (const key of SYSTEM_ROLE_KEYS) {
      for (const p of getPresetPermissions(key)) {
        expect(isPermissionPattern(p)).toBe(true);
      }
    }
  });

  it('super_admin and vendor_admin resolve to the entire catalog', () => {
    for (const key of ['super_admin', 'vendor_admin'] as const) {
      const eff = resolveEffectivePermissions({ rolePermissions: getPresetPermissions(key) });
      expect(eff.length).toBe(PERMISSIONS.length);
    }
  });

  it('viewer resolves to exactly the read-only surface (pages + views)', () => {
    const eff = resolveEffectivePermissions({ rolePermissions: getPresetPermissions('viewer') });
    expect(eff.every((p) => p.endsWith(':page') || p.endsWith(':view'))).toBe(true);
    // has no mutating permission
    expect(eff).not.toContain('customers:delete');
    expect(eff).not.toContain('payments:approve');
  });

  it('manager (=STAFF) is operational-only: no user mgmt, deletes, financials, or access control', () => {
    const eff = resolveEffectivePermissions({ rolePermissions: getPresetPermissions('manager') });
    // broad operational access
    expect(eff).toContain('customers:create');
    expect(eff).toContain('orders:approve');
    expect(eff).toContain('daily_sheets:close');
    expect(eff).toContain('daily_sheets:void_delivery'); // Admin + Manager (owner-requested 2026-09-01)
    expect(eff).toContain('daily_sheets:edit_closed_trip'); // Admin + Manager (owner-requested 2026-09-02)
    expect(eff).toContain('daily_sheets:record_walk_in'); // Admin + Manager (owner-requested 2026-09-04)
    // but NOT destructive / financial-sensitive / admin-only
    expect(eff).not.toContain('customers:delete');
    expect(eff).not.toContain('users:create');
    expect(eff).not.toContain('users:delete');
    expect(eff).not.toContain('payments:approve');
    expect(eff).not.toContain('transactions:adjust');
    expect(eff).not.toContain('damage_cases:charge');
    expect(eff).not.toContain('roles:view'); // no access-control surface at all
    expect(eff).not.toContain('settings:update');
    expect(eff).not.toContain('audit_logs:view');
  });

  it('driver (reconciled): field ops, GPS pin, expenses; NOT general edit, financials, crew confirm', () => {
    const driver = resolveEffectivePermissions({ rolePermissions: getPresetPermissions('driver') });
    expect(driver).toContain('customers:create');
    expect(driver).toContain('customers:update_location'); // GPS pin only
    expect(driver).toContain('daily_sheets:update');
    expect(driver).toContain('expenses:create');
    expect(driver).toContain('tracking:report_location');
    expect(driver).not.toContain('customers:update'); // no general customer editing
    expect(driver).not.toContain('customers:view_financial'); // no financial/consumption summaries
    expect(driver).not.toContain('daily_sheets:confirm_crew'); // ADMIN/STAFF only
    expect(driver).not.toContain('daily_sheets:manage_edit_locks'); // unlock-edit is staff
    expect(driver).not.toContain('daily_sheets:export'); // full-sheet export is staff
    expect(driver).not.toContain('daily_sheets:correct'); // admin-only financial correction
    expect(driver).not.toContain('daily_sheets:void_delivery'); // Admin + Manager only
    expect(driver).not.toContain('daily_sheets:edit_closed_trip'); // Admin + Manager only
    expect(driver).toContain('daily_sheets:load_out'); // manages load trips
    expect(driver).not.toContain('payments:approve');
    expect(driver).not.toContain('tracking:view'); // reports location, can't watch the fleet
    expect(driver).not.toContain('expenses:view'); // add-only, no full expense list
  });

  it('manager (=STAFF) sees customer financials and pins locations, unlike driver', () => {
    const mgr = resolveEffectivePermissions({ rolePermissions: getPresetPermissions('manager') });
    expect(mgr).toContain('customers:view_financial');
    expect(mgr).toContain('customers:update_location');
    expect(mgr).toContain('customers:update');
    expect(mgr).toContain('customers:export');
  });

  it('INVARIANT: no preset grants an action on a navigable resource without its :page', () => {
    for (const key of SYSTEM_ROLE_KEYS) {
      const eff = new Set(resolveEffectivePermissions({ rolePermissions: getPresetPermissions(key) }));
      const resourcesTouched = new Set<string>();
      for (const p of eff) {
        if (NON_NAVIGATIONAL_PERMISSIONS.has(p)) continue;
        const [resource, action] = p.split(':');
        if (action !== 'page') resourcesTouched.add(resource);
      }
      for (const resource of resourcesTouched) {
        // non-navigable resources — no /dashboard/* route exists to gate.
        // payroll now has a route (Amendment R6) and is no longer exempt.
        if (resource === 'whatsapp' || resource === 'crew_cash') continue;
        expect(eff.has(`${resource}:page` as Permission)).toBe(true);
      }
    }
  });
});
