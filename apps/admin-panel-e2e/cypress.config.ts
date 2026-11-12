import { nxE2EPreset } from '@nx/cypress/plugins/cypress-preset';
import { defineConfig } from 'cypress';
import { execFileSync } from 'node:child_process';

/**
 * Admin-panel e2e config.
 *
 * Ports: the API defaults to 3000, so the admin panel dev server is pinned to 4200
 * (same as project.json `serve`). Override everything per environment with:
 *   CYPRESS_BASE_URL, CYPRESS_API_URL, CYPRESS_ADMIN_EMAIL, CYPRESS_ADMIN_PASSWORD,
 *   CYPRESS_VENDOR_ADMIN_EMAIL, CYPRESS_VENDOR_ADMIN_PASSWORD, CYPRESS_REDIS_CONTAINER.
 * Credentials are never committed; supply them from the shell (dev seed values are in
 * libs/shared/database/prisma/seed.ts).
 */
const baseUrl = process.env['CYPRESS_BASE_URL'] || 'http://127.0.0.1:4200';
const redisContainer = process.env['CYPRESS_REDIS_CONTAINER'] || 'wscrm-redis';

/** Run redis-cli inside the dev Redis container (used only to reset throttler counters). */
function redisEval(script: string, ...args: string[]): string {
  return execFileSync(
    'docker',
    ['exec', redisContainer, 'redis-cli', '--raw', 'EVAL', script, '0', ...args],
    { encoding: 'utf8' },
  ).trim();
}

const DEL_BY_PATTERN =
  "local n=0 for _,p in ipairs(ARGV) do for _,k in ipairs(redis.call('keys',p)) do redis.call('del',k) n=n+1 end end return n";

export default defineConfig({
  e2e: {
    ...nxE2EPreset(__filename, {
      cypressDir: 'src',
      webServerCommands: {
        default: 'npx nx run admin-panel:dev --port=4200',
      },
      ciWebServerCommand: 'npx nx run admin-panel:start --port=4200',
      ciBaseUrl: 'http://127.0.0.1:4200',
    }),
    baseUrl,
    env: {
      apiUrl: process.env['CYPRESS_API_URL'] || 'http://localhost:3000/api',
      vendorDashboardUrl: process.env['CYPRESS_VENDOR_DASHBOARD_URL'] || 'http://localhost:4204',
      adminEmail: process.env['CYPRESS_ADMIN_EMAIL'] || '',
      adminPassword: process.env['CYPRESS_ADMIN_PASSWORD'] || '',
      vendorAdminEmail: process.env['CYPRESS_VENDOR_ADMIN_EMAIL'] || '',
      vendorAdminPassword: process.env['CYPRESS_VENDOR_ADMIN_PASSWORD'] || '',
    },
    retries: { runMode: 1, openMode: 0 },
    defaultCommandTimeout: 10000,
    video: false,
    setupNodeEvents(on) {
      on('task', {
        /** The API throttles /auth/login to 5/min per IP; reset between tests. */
        resetThrottle() {
          redisEval(DEL_BY_PATTERN, '{*}:hits', '{*}:blocked');
          return null;
        },
      });
    },
  },
});
