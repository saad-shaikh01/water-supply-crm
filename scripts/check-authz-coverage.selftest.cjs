/**
 * Negative self-test for scripts/check-authz-coverage.cjs (plan task Q-3 / B-12).
 *
 * Proves the coverage gate still bites: it drops a temporary controller into the scanned tree,
 * checks that
 *   1. a handler WITHOUT an authz marker adds exactly one failure and names the file,
 *   2. a handler WITH a marker (method-level) and a class-level marker add none,
 *   3. after the temp file is removed the failure count is back to the baseline.
 * The baseline is whatever the repo currently reports (pre-existing violations are not this
 * test's concern); only the delta is asserted.
 *
 * Run: node scripts/check-authz-coverage.selftest.cjs   (exit 0 = checker works)
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const CHECKER = path.resolve(__dirname, 'check-authz-coverage.cjs');
const TMP = path.resolve(
  __dirname,
  '..',
  'apps/api-backend/src/app/__authz-selftest__.controller.ts',
);

function run() {
  const res = spawnSync(process.execPath, [CHECKER], { encoding: 'utf8' });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  const m = out.match(/FAILED \((\d+)\)/);
  return { status: res.status, failures: m ? Number(m[1]) : 0, out };
}

function withTemp(source, fn) {
  fs.writeFileSync(TMP, source);
  try {
    return fn();
  } finally {
    fs.rmSync(TMP, { force: true });
  }
}

const errors = [];
const expect = (cond, msg) => {
  if (!cond) errors.push(msg);
};

if (fs.existsSync(TMP)) fs.rmSync(TMP, { force: true });
const baseline = run();

const UNMARKED = `import { Controller, Get } from '@nestjs/common';
@Controller('selftest')
export class SelfTestController {
  @Get()
  unprotected() {
    return 1;
  }
}
`;
const METHOD_MARKED = `import { Controller, Get } from '@nestjs/common';
@Controller('selftest')
export class SelfTestController {
  @Get()
  @RequireSuperAdmin()
  protectedHandler() {
    return 1;
  }
}
`;
const CLASS_MARKED = `import { Controller, Get } from '@nestjs/common';
@Controller('selftest')
@RequireSuperAdmin()
export class SelfTestController {
  @Get()
  covered() {
    return 1;
  }
}
`;

const bad = withTemp(UNMARKED, run);
expect(bad.status === 1, `unmarked handler: expected exit 1, got ${bad.status}`);
expect(
  bad.failures === baseline.failures + 1,
  `unmarked handler: expected ${baseline.failures + 1} failures, got ${bad.failures}`,
);
expect(
  bad.out.includes('__authz-selftest__.controller.ts') && bad.out.includes('unprotected'),
  'unmarked handler: failure output must name the file and the handler',
);

for (const [label, src] of [['method marker', METHOD_MARKED], ['class marker', CLASS_MARKED]]) {
  const ok = withTemp(src, run);
  expect(
    ok.failures === baseline.failures,
    `${label}: failure count changed (${baseline.failures} -> ${ok.failures})`,
  );
}

const after = run();
expect(
  after.failures === baseline.failures && after.status === baseline.status,
  `after cleanup: expected the baseline (${baseline.failures} failures, exit ${baseline.status}), got ${after.failures} / exit ${after.status}`,
);
expect(!fs.existsSync(TMP), 'temporary controller was not removed');

if (errors.length) {
  console.error('authz coverage self-test FAILED:');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(
  `authz coverage self-test OK (baseline ${baseline.failures} failures; unmarked handler -> ${bad.failures}, exit 1; markers pass; back to ${after.failures})`,
);
