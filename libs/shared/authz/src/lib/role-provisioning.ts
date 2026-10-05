/**
 * Vendor role provisioning — the single implementation of "give a vendor its system
 * roles" shared by the `rbac:seed` script and the backend's VendorProvisioningService
 * (new-vendor onboarding + the super-admin "repair" action).
 *
 * Deliberately Prisma-free: callers pass a structural `RoleProvisioningDb`, which both
 * a `PrismaClient` and an interactive-transaction client satisfy. That is what lets
 * vendor creation seed roles INSIDE its transaction (a role created through the
 * global client would be invisible to the not-yet-committed vendor row).
 *
 * Idempotency rules (unchanged from the original script):
 *   - Roles: find-or-create by (vendorId, key). An existing role is never rewritten —
 *     preset permissions are written only when the role is newly created, so admin
 *     customizations are never clobbered.
 *   - PRESET_DRIFT_BACKFILLS are additive only (createMany + skipDuplicates).
 */
import { getPresetPermissions, ROLE_PRESETS, SYSTEM_ROLE_KEYS, type RoleKey } from './presets';
import type { PermissionPattern } from './patterns';

/**
 * Known preset-drift backfills — permissions that were added to a role
 * preset in presets.ts AFTER many vendors' system roles already existed.
 * ensureRole() below only ever writes preset grants at first creation ("so
 * admin customizations are never clobbered") — it deliberately never
 * re-syncs an existing role, so any later preset addition silently never
 * reaches vendors seeded before that change. This list is the explicit,
 * additive (never subtractive) catch-up for each such gap: applied via
 * createMany + skipDuplicates, so it only ever ADDS a missing grant, never
 * removes one an admin may have deliberately taken away.
 *
 *   - fleet:record_check / fleet:record_fuel — added to `driver` for Fleet
 *     Operations Phase 1 (Amendment R7), and to `salesman` afterward (same
 *     field-ops rationale: Salesman rides the same van and can equally
 *     record the vehicle check). Vendors seeded before either addition never
 *     got the grant on their existing Driver/Salesman roles.
 *   - daily_sheets:void_delivery — added to `manager` for the Void Delivery
 *     feature (owner-requested 2026-09-01). Existing vendors' Manager roles
 *     predate it and need the catch-up grant.
 *   - daily_sheets:edit_closed_trip — added to `manager` for the Post-Close
 *     Trip Correction feature (owner-requested 2026-09-02). Same rationale:
 *     existing vendors' Manager roles predate it.
 *   - daily_sheets:record_walk_in — added to `manager` for the Walk-in /
 *     Self-Pickup Delivery feature (owner-requested 2026-09-04). Same rationale.
 *   - daily_sheets:edit_closed_expense — added to `manager` for the Post-Close
 *     Expense Correction feature (owner-requested 2026-09-07). Same rationale:
 *     existing vendors' Manager roles predate it.
 *   - customers:deactivate / customers:restore — added to `salesman` for the
 *     Customer Force Deactivate feature (owner-requested 2026-09-09) so field
 *     sales can close out customer accounts on the route. The guarded
 *     deactivate still refuses any customer with an outstanding balance;
 *     customers:force_deactivate (VENDOR_ADMIN only, no backfill) is what
 *     pushes past that. Existing vendors' Salesman roles predate the grant.
 *   - van_cash_ledger:view / van_cash_ledger:approve — added to `manager` and
 *     `accountant` for the Van Cash Ledger feature (owner-requested
 *     2026-09-09). Existing vendors' Manager/Accountant roles predate it and
 *     need the catch-up grant. `van_cash_ledger:manage` (opening balances)
 *     is VENDOR_ADMIN-only, no backfill.
 *   - van_cash_ledger:remit / van_cash_ledger:remit_approve — added to
 *     `manager` (both) and `accountant` (`remit` only) for the Office Cash
 *     Remittance feature (owner-requested 2026-09-10). `van_cash_ledger:
 *     remit_void` (voiding an already-approved remittance) is VENDOR_ADMIN-only,
 *     no backfill.
 *   - van_cash_ledger:export — added to `manager` and `accountant` for the Cash
 *     Ledger CSV / PDF export (Cash Ledger redesign P5, 2026-09-18). Existing
 *     vendors' Manager/Accountant roles predate it and need the catch-up grant.
 *   - payroll:attendance_view / payroll:attendance_mark — added to `manager`
 *     for Staff Attendance & Wage Types Phase 1 (owner-approved 2026-09-11,
 *     Amendment R16). Existing vendors' Manager roles predate the new actions
 *     and need the catch-up grant.
 *   - conversations:page/view/create/send/acknowledge — added to `salesman`
 *     for Communication Center acknowledgment-gate parity (owner-requested
 *     2026-09-15): Salesman now drives their own route (S43 parity) and
 *     needs the same conversation access Driver already has. Existing
 *     vendors' Salesman roles predate the module entirely.
 *   - fuel_cards:{page,view,manage,topup,topup_void} — new resource for the
 *     Fuel Card Wallet feature (owner-requested 2026-09-15). Existing vendors'
 *     Manager roles predate it entirely; Accountant gets `page/view/topup`
 *     only (no `manage`/`topup_void`, same split as the fresh preset).
 *   - product_costs:{view,manage} / analytics:view_margins — new resource +
 *     new analytics action for the Product Cost History & COGS feature
 *     (owner-requested 2026-09-15). Per the design doc's §8 preset table,
 *     these three are granted to Accountant (alongside Vendor Admin's `*`)
 *     as the trusted-financial-role tier — same confidentiality precedent as
 *     `payroll:view_all`. Existing vendors' Accountant roles predate this
 *     resource entirely and need the catch-up grant. Manager is deliberately
 *     NOT backfilled — the design doc excludes it by default.
 *   - customer_financial_adjustments:{view,create,create_credit,transfer,
 *     create_restricted,void} — new non-navigable resource for Customer
 *     Financial Adjustments (owner-approved 2026-09-21, Amendment R19). Accountant
 *     already holds the legacy `transactions:adjust`, so existing vendors'
 *     Accountant roles get the full set; Vendor Admin has it via `*`. Manager is
 *     deliberately NOT backfilled (no `transactions:adjust` either), nor any
 *     field role.
 *   - fuel_cards:view — added to `driver` and `salesman` (bugfix 2026-09-22):
 *     the Daily Sheet's "Log Fuel Fill" dialog needs it to populate the "pay
 *     from this card" picker; without it the dropdown rendered empty, so
 *     card-paid fills never got a fuelCardId and never drew down the card's
 *     balance. Existing vendors' Driver/Salesman roles predate the fix.
 *   - customer_deposits:{view,collect,refund,write_off,void} — new non-
 *     navigable resource for Customer Deposits (owner-requested 2026-09-29,
 *     Amendment R25). Same tier split as customer_financial_adjustments:
 *     Accountant gets the full set, Manager gets view+collect only. Existing
 *     vendors' Manager/Accountant roles predate this resource entirely.
 */
export const PRESET_DRIFT_BACKFILLS: Partial<Record<RoleKey, PermissionPattern[]>> = {
  driver: ['fleet:record_check', 'fleet:record_fuel', 'fuel_cards:view', 'extra_labour:create'],
  salesman: [
    'fleet:record_check',
    'fleet:record_fuel',
    'customers:deactivate',
    'customers:restore',
    // Communication Center (owner-requested 2026-09-15). Existing vendors'
    // Salesman roles predate the module entirely and need the catch-up
    // grant — same set Driver has held since the feature shipped.
    'conversations:page',
    'conversations:view',
    'conversations:create',
    'conversations:send',
    'conversations:acknowledge',
    // Fuel Card Wallet (bugfix 2026-09-22). See driver entry above.
    'fuel_cards:view',
  ],
  manager: [
    'daily_sheets:void_delivery',
    'daily_sheets:edit_closed_trip',
    // Walk-in / Self-Pickup Delivery (owner-requested 2026-09-04). Existing
    // vendors' Manager roles predate it and need the catch-up grant.
    'daily_sheets:record_walk_in',
    // Post-Close Expense Correction (owner-requested 2026-09-07). Existing
    // vendors' Manager roles predate it and need the catch-up grant.
    'daily_sheets:edit_closed_expense',
    // Van Cash Ledger (owner-requested 2026-09-09). Existing vendors' Manager
    // roles predate this new resource and need the catch-up grant. `manage`
    // (opening balances) is deliberately excluded — VENDOR_ADMIN-only.
    'van_cash_ledger:page',
    'van_cash_ledger:view',
    'van_cash_ledger:approve',
    // Office Cash Remittance (owner-requested 2026-09-10). Manager records AND
    // approves; `remit_void` stays VENDOR_ADMIN-only.
    'van_cash_ledger:remit',
    'van_cash_ledger:remit_approve',
    // Cash Ledger export (P5, 2026-09-18). Existing vendors' Manager roles
    // predate `export` and need the catch-up grant.
    'van_cash_ledger:export',
    // Staff Attendance & Wage Types Phase 1 (owner-approved 2026-09-11,
    // Amendment R16). Existing vendors' Manager roles predate these actions.
    'payroll:attendance_view',
    'payroll:attendance_mark',
    // Advance Installments (owner-requested 2026-09-24). Existing vendors'
    // Manager roles predate this action.
    'payroll:advance_plan_manage',
    // Fuel Card Wallet (owner-requested 2026-09-15). Existing vendors'
    // Manager roles predate this new resource entirely.
    'fuel_cards:page',
    'fuel_cards:view',
    'fuel_cards:manage',
    'fuel_cards:topup',
    'fuel_cards:topup_void',
    // Extra Labour (owner-approved 2026-09-22, Amendment R20). Existing vendors'
    // Manager roles predate this new resource entirely.
    'extra_labour:page',
    'extra_labour:view',
    'extra_labour:create',
    'extra_labour:manage',
    // Customer Flags (owner-requested 2026-09-29, Amendment R23). Existing
    // vendors' Manager roles predate this new resource entirely.
    'customer_flags:apply',
    // Fleet Alert Recipients (owner-requested 2026-09-29, Amendment R24).
    // Existing vendors' Manager roles predate this action.
    'fleet:manage_alerts',
    // Customer Deposits (owner-requested 2026-09-29, Amendment R25). Existing
    // vendors' Manager roles predate this new resource entirely. view+collect
    // only — refund/write_off/void stay Accountant/Vendor-Admin-only.
    'customer_deposits:view',
    'customer_deposits:collect',
  ],
  accountant: [
    // Van Cash Ledger (owner-requested 2026-09-09). Existing vendors'
    // Accountant roles predate it and need the catch-up grant. `manage`
    // (opening balances) is deliberately excluded — VENDOR_ADMIN-only.
    'van_cash_ledger:page',
    'van_cash_ledger:view',
    'van_cash_ledger:approve',
    // Office Cash Remittance (owner-requested 2026-09-10). Accountant may
    // RECORD a remittance only — not approve it (segregation of duties).
    'van_cash_ledger:remit',
    // Cash Ledger export (P5, 2026-09-18). Existing vendors' Accountant roles
    // predate `export` and need the catch-up grant.
    'van_cash_ledger:export',
    // Fuel Card Wallet (owner-requested 2026-09-15). Existing vendors'
    // Accountant roles predate this new resource entirely. `manage`/
    // `topup_void` deliberately excluded, same split as the fresh preset.
    'fuel_cards:page',
    'fuel_cards:view',
    'fuel_cards:topup',
    // Product Cost History & COGS (owner-requested 2026-09-15). Existing
    // vendors' Accountant roles predate this resource entirely and need the
    // catch-up grant — same trusted-financial-role tier as Vendor Admin.
    'product_costs:view',
    'product_costs:manage',
    'analytics:view_margins',
    // Customer Financial Adjustments (owner-approved 2026-09-21, Amendment R19).
    // Existing vendors' Accountant roles predate this resource entirely.
    'customer_financial_adjustments:view',
    'customer_financial_adjustments:create',
    'customer_financial_adjustments:create_credit',
    'customer_financial_adjustments:transfer',
    'customer_financial_adjustments:create_restricted',
    'customer_financial_adjustments:void',
    // Extra Labour (owner-approved 2026-09-22, Amendment R20). Existing vendors'
    // Accountant roles predate this new resource entirely.
    'extra_labour:page',
    'extra_labour:view',
    // Customer Flags (owner-requested 2026-09-29, Amendment R23). Existing
    // vendors' Accountant roles predate this new resource entirely.
    'customer_flags:apply',
    // Customer Deposits (owner-requested 2026-09-29, Amendment R25). Existing
    // vendors' Accountant roles predate this new resource entirely — full set.
    'customer_deposits:view',
    'customer_deposits:collect',
    'customer_deposits:refund',
    'customer_deposits:write_off',
    'customer_deposits:void',
  ],
};

/** Per-vendor system roles = every preset except the global-only super_admin. */
export const VENDOR_ROLE_KEYS: RoleKey[] = SYSTEM_ROLE_KEYS.filter((k) => k !== 'super_admin');

/**
 * The slice of a Prisma client that role provisioning touches. Structural on purpose —
 * both `PrismaClient` and `Prisma.TransactionClient` are assignable to it.
 */
export interface RoleProvisioningDb {
  role: {
    findFirst(args: { where: { vendorId: string | null; key: string } }): Promise<{ id: string } | null>;
    create(args: {
      data: {
        vendorId: string | null;
        key: string;
        name: string;
        description?: string | null;
        isSystem: boolean;
        isDefault: boolean;
        permissions?: { create: { permission: string }[] };
      };
    }): Promise<{ id: string }>;
  };
  rolePermission: {
    createMany(args: {
      data: { roleId: string; permission: string }[];
      skipDuplicates?: boolean;
    }): Promise<{ count: number }>;
  };
}

export interface EnsureRoleResult {
  roleId: string;
  created: boolean;
}

/**
 * Find-or-create one system role (and its preset grants) for `vendorId` (null = the
 * global super_admin). findFirst, not findUnique, because a null vendorId is distinct
 * to SQL uniqueness. The role and its grants are written in ONE nested create, so a
 * role can never exist without its seed permissions.
 */
export async function ensureRole(
  db: RoleProvisioningDb,
  vendorId: string | null,
  key: RoleKey,
): Promise<EnsureRoleResult> {
  const existing = await db.role.findFirst({ where: { vendorId, key } });
  if (existing) return { roleId: existing.id, created: false };

  const preset = ROLE_PRESETS[key];
  const permissions = getPresetPermissions(key);
  const role = await db.role.create({
    data: {
      vendorId,
      key,
      name: preset.name,
      description: preset.description,
      isSystem: true,
      isDefault: false,
      ...(permissions.length ? { permissions: { create: permissions.map((permission) => ({ permission })) } } : {}),
    },
  });
  return { roleId: role.id, created: true };
}

export interface EnsureVendorRolesResult {
  roleIdByKey: Map<RoleKey, string>;
  rolesCreated: number;
  driftGrantsAdded: number;
}

/**
 * Ensure every per-vendor system role exists, then apply the additive preset-drift
 * catch-up. Safe to re-run indefinitely: a no-op once the vendor is complete.
 */
export async function ensureVendorRoles(
  db: RoleProvisioningDb,
  vendorId: string,
): Promise<EnsureVendorRolesResult> {
  const roleIdByKey = new Map<RoleKey, string>();
  let rolesCreated = 0;
  for (const key of VENDOR_ROLE_KEYS) {
    const res = await ensureRole(db, vendorId, key);
    roleIdByKey.set(key, res.roleId);
    if (res.created) rolesCreated++;
  }

  // Runs on every call (not only for newly-created roles): skipDuplicates makes it a
  // no-op once a role already has the grant, and it is what reaches vendors whose
  // system roles predate a later preset addition.
  let driftGrantsAdded = 0;
  for (const [key, perms] of Object.entries(PRESET_DRIFT_BACKFILLS) as [RoleKey, PermissionPattern[]][]) {
    const roleId = roleIdByKey.get(key);
    if (!roleId) continue;
    const res = await db.rolePermission.createMany({
      data: perms.map((permission) => ({ roleId, permission })),
      skipDuplicates: true,
    });
    driftGrantsAdded += res.count;
  }

  return { roleIdByKey, rolesCreated, driftGrantsAdded };
}
