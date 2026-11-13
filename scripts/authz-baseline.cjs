#!/usr/bin/env node
/* eslint-disable */
/**
 * authz:check against a committed baseline (scripts/authz-baseline.txt).
 * `check-authz-coverage.cjs` exits non-zero on main (pre-existing unguarded handlers). This wrapper fails only on
 * findings NOT in the baseline (key = file + handler name, with counts). Run with --write to regenerate the baseline.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const baselineFile = path.join(__dirname, 'authz-baseline.txt');

function parse(text) {
  const keys = {};
  for (const l of text.split(/\r?\n/)) {
    const m = l.match(/^\s+- (\S+) → "(?:async\s+)?(\w+)\(/);
    if (m) {
      const k = m[1].split(String.fromCharCode(92)).join('/') + ' ' + m[2];
      keys[k] = (keys[k] || 0) + 1;
    }
  }
  return keys;
}

const legacy = spawnSync('node', [path.join(__dirname, 'check-no-legacy-authz.cjs')], { stdio: 'inherit' });
if (legacy.status !== 0) process.exit(legacy.status || 1);

const r = spawnSync('node', [path.join(__dirname, 'check-authz-coverage.cjs')], { encoding: 'utf8' });
const out = (r.stdout || '') + (r.stderr || '');
const found = parse(out);

if (process.argv.includes('--write')) {
  const lines = ['# Pre-existing authz:check findings on main (file + handler name + count). Do not add new entries.'];
  for (const k of Object.keys(found).sort()) lines.push(k + ' ' + found[k]);
  fs.writeFileSync(baselineFile, lines.join('\n') + '\n');
  console.log('baseline written: ' + (lines.length - 1) + ' entries');
  process.exit(0);
}

if (r.status === 0) { console.log('authz coverage: clean'); process.exit(0); }
const base = {};
for (const l of fs.readFileSync(baselineFile, 'utf8').split(/\r?\n/)) {
  if (!l || l.startsWith('#')) continue;
  const i = l.lastIndexOf(' ');
  base[l.slice(0, i)] = Number(l.slice(i + 1));
}
const fresh = Object.keys(found).filter((k) => found[k] > (base[k] || 0));
if (!Object.keys(found).length) { console.error('authz coverage failed but no findings parsed:\n' + out); process.exit(1); }
if (fresh.length) {
  console.error('NEW authz findings not in baseline:');
  for (const k of fresh) console.error('  - ' + k);
  process.exit(1);
}
console.log('authz coverage: ' + Object.keys(found).length + ' known pre-existing findings (baseline), 0 new');
