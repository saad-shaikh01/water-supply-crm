const nextJest = require('next/jest.js');

const createJestConfig = nextJest({
  dir: './',
});

const config = {
  displayName: 'admin-panel',
  preset: '../../jest.preset.js',
  transform: {
    '^(?!.*\\.(js|jsx|ts|tsx|css|json)$)': '@nx/react/plugins/jest',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  coverageDirectory: '../../coverage/apps/admin-panel',
  testEnvironment: 'jsdom',
  collectCoverageFrom: [
    'src/features/**/*.{ts,tsx}',
    'src/app/**/*.{ts,tsx}',
    'src/components/**/*.{ts,tsx}',
    'src/lib/**/*.{ts,tsx}',
    'src/middleware.ts',
    '!src/**/*.d.ts',
    '!src/**/*.spec.{ts,tsx}',
    '!src/**/index.ts',
    '!src/**/layout.tsx',
  ],
  // Thresholds are set ~4-5 points below measured values (2026-11) so they
  // catch regressions without being flaky. Raise them as coverage improves.
  // Not thresholded yet (low coverage, follow-up): audit, health, imports,
  // vendor-picker, app/(dashboard) page wrappers.
  coverageThreshold: {
    // Jest excludes path-thresholded dirs from 'global': this covers the rest
    // (audit, health, imports, vendor-picker, whatsapp, components, lib, app pages).
    global: { statements: 51, branches: 49, functions: 42, lines: 51 },
    './src/features/auth/': { statements: 87, branches: 87, functions: 73, lines: 88 },
    './src/features/security/': { statements: 75, branches: 80, functions: 67, lines: 73 },
    './src/features/settings/': { statements: 90, branches: 80, functions: 83, lines: 90 },
    './src/features/platform-admins/': { statements: 75, branches: 69, functions: 64, lines: 74 },
    './src/features/vendors/': { statements: 70, branches: 60, functions: 60, lines: 72 },
    './src/features/observability/': { statements: 69, branches: 66, functions: 70, lines: 75 },
    './src/features/impersonation/': { statements: 82, branches: 80, functions: 66, lines: 83 },
    './src/features/billing/': { statements: 46, branches: 39, functions: 31, lines: 47 },
    './src/features/announcements/': { statements: 58, branches: 49, functions: 42, lines: 57 },
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
};

module.exports = createJestConfig(config);
