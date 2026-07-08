/**
 * Legacy-authorization gate. Fails if the removed role-based system reappears:
 *   - `@Roles(` decorator usage
 *   - `RolesGuard` references
 *   - imports of the deleted roles.guard / roles.decorator
 *
 * The RBAC system is permission-based (@RequirePermissions) with role markers
 * (@RequireSuperAdmin / @RequireCustomer / @RequireRoles) for platform/portal only.
 *
 * Run: node scripts/check-no-legacy-authz.cjs
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'apps/api-backend/src');
const FORBIDDEN = [
  { re: /@Roles\s*\(/, msg: '@Roles() decorator (use @RequirePermissions / @RequireRoles)' },
  { re: /\bRolesGuard\b/, msg: 'RolesGuard (use the global PermissionsGuard)' },
  { re: /roles\.(guard|decorator)/, msg: 'import of the deleted roles.guard/roles.decorator' },
];

function walk(dir) {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walk(p));
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const hits = [];
for (const file of walk(ROOT)) {
  const text = fs
    .readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  for (const { re, msg } of FORBIDDEN) {
    if (re.test(text)) hits.push(`${path.relative(ROOT, file)} → ${msg}`);
  }
}

if (hits.length) {
  console.error(`❌ Legacy authorization detected (${hits.length}):`);
  for (const h of hits) console.error('  - ' + h);
  process.exit(1);
}
console.log('✅ No legacy authorization (@Roles / RolesGuard) present.');
