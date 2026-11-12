#!/usr/bin/env node
/* eslint-disable */
/**
 * verify:admin - fail-fast verification of the admin-panel work.
 * Cross-platform, no nx. Flags:
 *   --e2e        also run Cypress (needs api-backend + admin-panel already running)
 *   --skip-backend  skip backend jest
 *   --only=<substr>  run only steps whose name contains substr
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const withE2e = args.includes('--e2e');
const skipBackend = args.includes('--skip-backend');
const only = (args.find((a) => a.startsWith('--only=')) || '').slice(7);

// Admin-related backend modules only. Excludes vendor/tenant-security, payroll,
// van-cash, notifications, pdf (pre-existing failures unrelated to admin work).
const ADMIN_BACKEND_MODULES = [
  'platform-admin',
  'platform-settings',
  'platform-observability',
  'announcements',
  'impersonation',
  'vendor-readiness',
  'auth/',
  'billing',
  'vendor/vendor-',
  'vendor/dto',
  'audit/',
  'dashboard/platform-overview',
];
const backendPattern = ADMIN_BACKEND_MODULES.map((m) => 'modules/' + m).join('|');

const steps = [
  { name: 'admin-panel jest (coverage thresholds)', cwd: 'apps/admin-panel', cmd: ['npx', 'jest', '--coverage'] },
  { name: 'tsc admin-panel', cmd: ['npx', 'tsc', '--noEmit', '-p', 'apps/admin-panel/tsconfig.json'] },
  { name: 'tsc admin-panel-e2e', cmd: ['npx', 'tsc', '--noEmit', '-p', 'apps/admin-panel-e2e/tsconfig.json'] },
  { name: 'eslint admin-panel src', cmd: ['npx', 'eslint', '-c', 'apps/admin-panel/eslint.config.mjs', 'apps/admin-panel/src'] },
  ...(skipBackend
    ? []
    : [{
        name: 'backend jest (admin modules)',
        cmd: ['npx', 'jest', '-c', 'apps/api-backend/jest.config.cts', '--testPathPatterns', '"' + backendPattern + '"'],
      }]),
  { name: 'authz:check', cmd: ['npm', 'run', '--silent', 'authz:check'] },
  { name: 'authz selftest', cmd: ['node', 'scripts/check-authz-coverage.selftest.cjs'] },
  ...(withE2e
    ? [{ name: 'cypress e2e (servers must be running)', cmd: ['npx', 'cypress', 'run', '--project', 'apps/admin-panel-e2e', '--config-file', 'cypress.config.ts'] }]
    : []),
].filter((s) => !only || s.name.includes(only));

const results = [];
let failed = false;
for (const s of steps) {
  console.log(`\n=== ${s.name} ===`);
  const t = Date.now();
  const r = spawnSync(s.cmd.join(' '), { cwd: path.join(root, s.cwd || '.'), stdio: 'inherit', shell: true });
  const ok = r.status === 0;
  results.push({ name: s.name, ok, sec: ((Date.now() - t) / 1000).toFixed(1) });
  if (!ok) { failed = true; break; }
}
console.log('\n=== verify:admin summary ===');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.sec.padStart(7)}s  ${r.name}`);
if (!withE2e) console.log('SKIP  cypress e2e (pass --e2e with servers running)');
if (failed) { console.error('\nverify:admin FAILED (stopped at first failure)'); process.exit(1); }
console.log('\nverify:admin OK');
