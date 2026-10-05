/**
 * RBAC Seeder + Backfill (Phase A4) — idempotent and production-safe.
 *
 * Unlike seed.ts (destructive demo data), this script NEVER wipes or overwrites:
 *   1. Seeds the global `super_admin` role (vendorId = null).
 *   2. Seeds the per-vendor system roles from ROLE_PRESETS for every vendor.
 *   3. Backfills User.roleId from the legacy User.role enum (only where unset).
 *
 * Idempotency rules:
 *   - Roles: find-or-create by (vendorId, key). Existing roles are left untouched —
 *     preset permissions are written ONLY when the role is newly created, so admin
 *     customizations (added/removed permissions) are never clobbered.
 *   - Backfill: only users with roleId = null are updated, so manual (re)assignments
 *     are preserved. CUSTOMER users are intentionally left unassigned (portal-only).
 *
 * Usage:
 *   npm run rbac:seed            # apply (requires DATABASE_URL)
 *   npm run rbac:seed -- --check # dry run: validate plan, print summary, NO DB access
 */
import { PrismaClient } from '@prisma/client';
// Consumed through the public package alias (resolved at runtime by tsconfig-paths via
// tsconfig.scripts.json). Single frozen catalog — no duplication, no internal src reach.
import {
  ROLE_PRESETS,
  SYSTEM_ROLE_KEYS,
  LEGACY_ROLE_TO_KEY,
  PRESET_DRIFT_BACKFILLS,
  VENDOR_ROLE_KEYS,
  ensureRole,
  ensureVendorRoles,
  getPresetPermissions,
  isPermissionPattern,
  type RoleKey,
} from '@water-supply-crm/authz';

// ── Dry-run validation (no database) ──────────────────────────────────────────
function runCheck(): void {
  console.log('🔎 RBAC seed — dry run (no database access)\n');

  let invalid = 0;
  for (const key of SYSTEM_ROLE_KEYS) {
    const preset = ROLE_PRESETS[key];
    const perms = getPresetPermissions(key);
    const bad = perms.filter((p) => !isPermissionPattern(p));
    invalid += bad.length;
    const scope = key === 'super_admin' ? 'GLOBAL' : 'per-vendor';
    console.log(
      `  ${preset.name.padEnd(14)} [${key}] ${scope.padEnd(10)} ${perms.length} grant(s)` +
        (bad.length ? `  ⚠️ INVALID: ${bad.join(', ')}` : ''),
    );
  }

  console.log('\n  Legacy → new role mapping:');
  for (const [legacy, key] of Object.entries(LEGACY_ROLE_TO_KEY)) {
    console.log(`    ${legacy.padEnd(13)} → ${key ?? '(unassigned — portal only)'}`);
  }

  console.log('\n  Preset-drift backfills (additive catch-up for existing roles):');
  for (const [key, perms] of Object.entries(PRESET_DRIFT_BACKFILLS)) {
    const bad = perms.filter((p) => !isPermissionPattern(p));
    invalid += bad.length;
    console.log(
      `    ${key.padEnd(14)} + ${perms.join(', ')}` + (bad.length ? `  ⚠️ INVALID: ${bad.join(', ')}` : ''),
    );
  }

  console.log(
    `\n  Plan: 1 global role + ${VENDOR_ROLE_KEYS.length} roles per vendor. Invalid permission grants: ${invalid}.`,
  );
  if (invalid > 0) {
    console.error('❌ Invalid permission grants found — aborting before any DB write.');
    process.exit(1);
  }
  console.log('✅ Dry run passed: every preset grant is a valid permission pattern.\n');
}

// ── Seeding (idempotent) ──────────────────────────────────────────────────────
async function seedAndBackfill(prisma: PrismaClient): Promise<void> {
  console.log('🌱 RBAC seed — applying (idempotent)\n');

  // IDs of every user whose roleId this run sets — the effective-permission cache
  // (`authz:perms:{userId}`, 1h TTL, Redis) is keyed by user and is NEVER cleared
  // by a plain DB update. A user who logged in even once while roleId was still
  // null (e.g. between deploy and this script running) has an empty permission
  // set cached; without an explicit invalidation below they'd keep seeing Access
  // Denied for up to an hour after the DB is already correct.
  const backfilledUserIds: string[] = [];

  // 1. Global super_admin role.
  const superAdmin = await ensureRole(prisma, null, 'super_admin');
  console.log(`  Global super_admin role ${superAdmin.created ? 'created' : 'exists'}.`);

  // Backfill SUPER_ADMIN users (vendor-agnostic) → global super_admin, only if unset.
  const superAdminTargets = await prisma.user.findMany({
    where: { role: 'SUPER_ADMIN', roleId: null },
    select: { id: true },
  });
  const superRes = await prisma.user.updateMany({
    where: { id: { in: superAdminTargets.map((u) => u.id) } },
    data: { roleId: superAdmin.roleId },
  });
  backfilledUserIds.push(...superAdminTargets.map((u) => u.id));
  console.log(`  Backfilled ${superRes.count} SUPER_ADMIN user(s).\n`);

  // 2. Per-vendor roles + backfill.
  const vendors = await prisma.vendor.findMany({ select: { id: true, name: true } });
  console.log(`  ${vendors.length} vendor(s) found.\n`);

  let rolesCreated = 0;
  let usersBackfilled = 0;
  let driftGrantsBackfilled = 0;

  for (const vendor of vendors) {
    const { roleIdByKey, rolesCreated: created, driftGrantsAdded } = await ensureVendorRoles(prisma, vendor.id);
    rolesCreated += created;
    driftGrantsBackfilled += driftGrantsAdded;

    // Backfill this vendor's users by legacy role (only where roleId is null).
    for (const [legacy, key] of Object.entries(LEGACY_ROLE_TO_KEY)) {
      if (!key || key === 'super_admin') continue; // handled globally / unassigned
      const targetRoleId = roleIdByKey.get(key);
      if (!targetRoleId) continue;
      const targets = await prisma.user.findMany({
        where: { vendorId: vendor.id, role: legacy as never, roleId: null },
        select: { id: true },
      });
      if (!targets.length) continue;
      const res = await prisma.user.updateMany({
        where: { id: { in: targets.map((u) => u.id) } },
        data: { roleId: targetRoleId },
      });
      backfilledUserIds.push(...targets.map((u) => u.id));
      usersBackfilled += res.count;
    }
  }

  console.log(`  Roles created this run: ${rolesCreated}`);
  console.log(`  Preset-drift permission grants backfilled this run: ${driftGrantsBackfilled}`);
  console.log(`  Users backfilled this run: ${usersBackfilled}\n`);

  await invalidatePermissionCache(backfilledUserIds);
}

/**
 * Best-effort Redis cache bust for every user this run just gave a roleId to.
 * Uses `authz:perms:{userId}` — the exact key `PermissionService` reads/writes
 * (see apps/api-backend/src/app/modules/authz/permission.service.ts). Never
 * throws: a missing/unreachable REDIS_URL just means the DB fix still applies,
 * it takes up to the 1h cache TTL to be visible instead of immediately.
 */
async function invalidatePermissionCache(userIds: string[]): Promise<void> {
  if (!userIds.length) return;
  const url = process.env['REDIS_URL'];
  if (!url) {
    console.log('  ⚠️ REDIS_URL not set — skipping cache invalidation. Affected users will see');
    console.log('     stale Access Denied for up to 1h until their cached permissions expire.\n');
    return;
  }

  let Redis: typeof import('ioredis').default;
  try {
    ({ default: Redis } = await import('ioredis'));
  } catch {
    console.log('  ⚠️ ioredis not available — skipping cache invalidation (DB fix still applies).\n');
    return;
  }

  const client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await client.connect();
    const keys = userIds.map((id) => `authz:perms:${id}`);
    await client.del(...keys);
    console.log(`  🔄 Invalidated cached permissions for ${userIds.length} backfilled user(s).\n`);
  } catch (e) {
    console.log(`  ⚠️ Cache invalidation failed (${(e as Error).message}) — DB fix still applies,`);
    console.log('     affected users will see stale Access Denied for up to 1h.\n');
  } finally {
    client.disconnect();
  }
}

// ── Post-run validation (database) ────────────────────────────────────────────
async function validate(prisma: PrismaClient): Promise<void> {
  console.log('🔬 Validating...\n');
  let failures = 0;

  // a) Every role permission references a valid catalog pattern.
  const perms = await prisma.rolePermission.findMany({ select: { permission: true } });
  const invalid = perms.filter((p) => !isPermissionPattern(p.permission));
  console.log(`  Role permissions: ${perms.length} total, ${invalid.length} invalid`);
  if (invalid.length) {
    failures++;
    console.error(`    ⚠️ Invalid: ${[...new Set(invalid.map((p) => p.permission))].join(', ')}`);
  }

  // b) Non-CUSTOMER users should all have a roleId after backfill.
  const unassigned = await prisma.user.count({
    where: { roleId: null, role: { not: 'CUSTOMER' as never } },
  });
  console.log(`  Non-CUSTOMER users without roleId: ${unassigned}`);
  if (unassigned > 0) failures++;

  // c) Every vendor has the full set of system roles.
  const vendors = await prisma.vendor.findMany({ select: { id: true } });
  for (const v of vendors) {
    const count = await prisma.role.count({
      where: { vendorId: v.id, key: { in: VENDOR_ROLE_KEYS }, isSystem: true },
    });
    if (count !== VENDOR_ROLE_KEYS.length) {
      failures++;
      console.error(`    ⚠️ Vendor ${v.id} has ${count}/${VENDOR_ROLE_KEYS.length} system roles`);
    }
  }
  console.log(`  Vendors checked: ${vendors.length}`);

  // d) Global super_admin exists exactly once.
  const globalSupers = await prisma.role.count({ where: { vendorId: null, key: 'super_admin' } });
  console.log(`  Global super_admin roles: ${globalSupers} (expected 1)`);
  if (globalSupers !== 1) failures++;

  if (failures > 0) {
    console.error(`\n❌ Validation failed with ${failures} issue(s).`);
    process.exit(1);
  }
  console.log('\n✅ Validation passed.\n');
}

async function main(): Promise<void> {
  const isCheck = process.argv.includes('--check') || process.env['DRY_RUN'] === '1';

  if (isCheck) {
    runCheck();
    return; // never touches the database
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: process.env['DATABASE_URL'] } },
  });
  try {
    runCheck(); // fail fast on any invalid preset before writing
    await seedAndBackfill(prisma);
    await validate(prisma);
    console.log('═══════════════════════════════════════════════');
    console.log('  RBAC SEED COMPLETE');
    console.log('═══════════════════════════════════════════════\n');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('❌ RBAC seed failed:', e);
  process.exit(1);
});
