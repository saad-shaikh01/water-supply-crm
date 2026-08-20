/**
 * One-shot diagnostic: "why doesn't user X have permission Y?"
 * Prints the user's assigned role, that role's raw permissions, any per-user
 * overrides, and the final computed effective permission set — the exact same
 * resolution PermissionService.getEffectivePermissions() does — so you don't
 * have to manually cross-reference the Roles UI + Users UI + guess about cache.
 *
 * Usage (run on the VPS, where DATABASE_URL is set):
 *   node -r ./scripts/register-ts-paths.cjs libs/shared/database/prisma/debug-user-permissions.ts <email> [permission ...]
 *
 * Example:
 *   node -r ./scripts/register-ts-paths.cjs libs/shared/database/prisma/debug-user-permissions.ts driver1@example.com daily_sheets:update crew_cash:create
 */
import { PrismaClient } from '@prisma/client';
import { resolveEffectivePermissions, hasPermission, type PermissionPattern, type Permission } from '@water-supply-crm/authz';

async function main() {
  const [email, ...permsToCheck] = process.argv.slice(2);
  if (!email) {
    console.error('Usage: debug-user-permissions.ts <email> [permission ...]');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findFirst({
      where: { email },
      include: {
        roleRef: { include: { permissions: { select: { permission: true } } } },
        permissionOverrides: { select: { permission: true, effect: true, expiresAt: true } },
      },
    });

    if (!user) {
      console.error(`No user found with email "${email}"`);
      process.exit(1);
    }

    console.log('──────────────────────────────────────────');
    console.log(`User:        ${user.name ?? '(no name)'} <${user.email}>`);
    console.log(`User.id:     ${user.id}`);
    console.log(`User.role:   ${user.role} (legacy enum, drives isDriver etc. on frontend)`);
    console.log(`User.roleId: ${user.roleId ?? '(none — no RBAC role assigned!)'}`);

    if (!user.roleRef) {
      console.log('\n⚠️  This user has NO Role assigned (roleId is null). They get ZERO permissions');
      console.log('    from RBAC regardless of what any "Driver" role has ticked. Assign a role to them.');
      return;
    }

    console.log(`Assigned Role: "${user.roleRef.name}" (key: ${user.roleRef.key}, isSystem: ${user.roleRef.isSystem})`);
    console.log(`\nRole's raw permissions (${user.roleRef.permissions.length}):`);
    for (const p of user.roleRef.permissions.map((p) => p.permission).sort()) {
      console.log(`   - ${p}`);
    }

    console.log(`\nPer-user overrides (${user.permissionOverrides.length}):`);
    if (user.permissionOverrides.length === 0) console.log('   (none)');
    for (const o of user.permissionOverrides) {
      const expired = o.expiresAt && o.expiresAt < new Date();
      console.log(`   - ${o.effect} ${o.permission}${o.expiresAt ? ` (expires ${o.expiresAt.toISOString()}${expired ? ' — EXPIRED' : ''})` : ''}`);
    }

    const rolePermissions: PermissionPattern[] = user.roleRef.permissions.map((p) => p.permission as PermissionPattern);
    const overrides = user.permissionOverrides.map((o) => ({
      permission: o.permission as PermissionPattern,
      effect: o.effect as 'ALLOW' | 'DENY',
      expiresAt: o.expiresAt,
    }));
    const effective = resolveEffectivePermissions({ rolePermissions, overrides });
    const effectiveSet = new Set<Permission>(effective);

    console.log(`\nComputed EFFECTIVE permission count: ${effective.length}`);

    const toCheck = permsToCheck.length > 0 ? permsToCheck : ['daily_sheets:update', 'crew_cash:create'];
    console.log('\nChecking specific permissions:');
    for (const perm of toCheck) {
      const result = hasPermission(effectiveSet, perm as Permission);
      console.log(`   ${result ? '✅' : '❌'} ${perm}`);
    }

    console.log('\n(Note: this reads the DB directly, bypassing the 1h Redis permission cache —');
    console.log(' if this says ✅ but the app still says no, the cache is stale: have the user log');
    console.log(' out/in, or flush the redis key `authz:perms:' + user.id + '`.)');
    console.log('──────────────────────────────────────────');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
