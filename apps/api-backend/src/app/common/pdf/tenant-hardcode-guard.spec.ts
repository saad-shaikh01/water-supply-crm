/**
 * CI guard (multi-vendor design doc §4 "Safety nets"): Dasani / Blue Ice's company identity, bank and
 * contact details must not creep back into application code. Customer-facing documents get them
 * from VendorBranding; the only allowed homes are the legacy fallback constants, the golden/specs and
 * the repo's own one-off scripts.
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC_ROOT = path.resolve(__dirname, '..', '..', '..'); // apps/api-backend/src

const FORBIDDEN = [
  /DASANI ENTERPRISES/i,
  /9933-0104414597/,
  /Meezan Bank/i,
  /03162677954/,
  /0316-2677954/,
  /0345-2364698/,
  /info@blueice\.com\.pk/i,
  /blueice\.com\.pk/i,
  /Gulshan e Iqbal/i,
];

/** Paths (relative to apps/api-backend/src, forward slashes) allowed to contain them. */
const ALLOWED = [
  'app/common/pdf/legacy-dasani-branding.ts', // the Blue Ice safety-net constants
  'app/modules/customer/pdf/customer-statement-pdf.service.debug.ts', // standalone dev script, not part of the app build
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__golden__') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|json|html)$/.test(entry.name) && !/\.spec\.ts$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('no hardcoded Dasani / Blue Ice company details in application code', () => {
  it('only the allow-listed files contain them', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC_ROOT)) {
      const rel = path.relative(SRC_ROOT, file).split(path.sep).join('/');
      if (ALLOWED.includes(rel)) continue;
      const text = fs.readFileSync(file, 'utf8');
      for (const re of FORBIDDEN) {
        if (re.test(text)) offenders.push(`${rel} matches ${re}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
