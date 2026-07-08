/**
 * Authorization coverage gate.
 *
 * Fails if any controller route handler lacks an explicit authorization marker
 * (@Public / @AuthenticatedOnly / @RequireSuperAdmin / @RequireCustomer / @RequireRoles /
 *  @RequirePermissions / @RequireAnyPermission / @RequirePage) either on the method or
 * inherited from the class. Prevents "implicit" authorization once the global
 * deny-by-default PermissionsGuard is active.
 *
 * Run: node scripts/check-authz-coverage.cjs
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'apps/api-backend/src/app');
const MARKERS = [
  '@Public',
  '@AuthenticatedOnly',
  '@RequireSuperAdmin',
  '@RequireCustomer',
  '@RequireRoles',
  '@RequirePermissions',
  '@RequireAnyPermission',
  '@RequirePage',
];
const ROUTE_RE = /^@(Get|Post|Patch|Put|Delete|All)\(/;
const METHOD_START_RE = /^(async\s+)?[a-zA-Z_][\w]*\s*\(/;

function walk(dir) {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walk(p));
    else if (e.name.endsWith('.controller.ts')) out.push(p);
  }
  return out;
}

const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const hasMarker = (text) => MARKERS.some((m) => text.includes(m));

const failures = [];
let handlerCount = 0;

for (const file of walk(ROOT)) {
  const lines = stripComments(fs.readFileSync(file, 'utf8')).split('\n');
  const classIdx = lines.findIndex((l) => /export class/.test(l));
  const ctrlIdx = lines.findIndex((l) => /@Controller\(/.test(l));
  if (classIdx === -1 || ctrlIdx === -1) continue;

  const classDecorators = lines.slice(ctrlIdx, classIdx).join('\n');
  const classCovered = hasMarker(classDecorators);

  let pending = [];
  let depth = 0;
  let buf = '';
  for (let i = classIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (t.startsWith('@') || depth > 0) {
      buf += line + '\n';
      depth += (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length;
      if (depth <= 0) {
        pending.push(buf);
        buf = '';
        depth = 0;
      }
      continue;
    }
    const deco = pending.join('\n');
    if (METHOD_START_RE.test(t)) {
      if (/@(Get|Post|Patch|Put|Delete|All)\(/.test(deco)) {
        handlerCount++;
        if (!classCovered && !hasMarker(deco)) {
          failures.push(`${path.relative(ROOT, file)} → "${t}" lacks an authorization marker`);
        }
      }
      pending = [];
    } else if (t !== '') {
      pending = [];
    }
  }
}

if (failures.length) {
  console.error(`❌ Authz coverage FAILED (${failures.length}):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(`✅ Authz coverage: all ${handlerCount} route handlers have an authorization marker.`);
