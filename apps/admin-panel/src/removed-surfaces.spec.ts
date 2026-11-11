import fs from 'fs';
import path from 'path';

/** Guards against parallel branches re-introducing removed Phase 1 surfaces. */
describe('removed surfaces (A8)', () => {
  const src = __dirname;
  it.each([
    'app/auth/signup',
    'app/(dashboard)/products',
    'features/products',
    'app/api/hello',
    'app/page.tsx',
    'app/page.module.css',
    'features/auth/components/signup-form.tsx',
  ])('%s does not exist', (rel) => {
    expect(fs.existsSync(path.join(src, rel))).toBe(false);
  });
});
