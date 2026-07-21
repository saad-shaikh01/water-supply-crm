'use strict';

// PM2 ecosystem config — DASANI ENTERPRISES tenant.
// Mirrors ecosystem.config.js (testinglinq) but on a fully separate port range
// and pointed at dasani-postgres / dasani-redis (docker-compose.dasani.yml).
//
// Prerequisites on the VPS (shared with testinglinq, no re-install needed):
//   npm install -g pm2   # already done for testinglinq
//
// Deploy / reload:
//   bash deploy/deploy-dasani.sh
//   pm2 startOrRestart ecosystem.dasani.config.js --update-env   # reload only
//
// Env vars are read from the shell environment at the time pm2 is invoked.
// deploy-dasani.sh sources .env.live before calling pm2 so all secrets are
// captured and survive process restarts.
//
// IMPORTANT — .env.live DATABASE_URL must point to 127.0.0.1:5433 (dasani-postgres),
// NOT 5432 (that's wscrm-postgres / testinglinq) and NOT the Docker service name.

const path = require('path');
const ROOT = __dirname;

// Infrastructure addresses differ between Docker (DNS service names) and the
// host (loopback). Hard-coded here so they are always correct regardless of
// what .env.live says for REDIS_HOST / REDIS_URL. Port 6382 = dasani-redis —
// NOT 6379 (wscrm-redis/testinglinq) and NOT 6380 (collides with an unrelated
// project's sentra_redis_testing container on this VPS).
const infraOverrides = {
  REDIS_URL: 'redis://127.0.0.1:6382',
  REDIS_HOST: '127.0.0.1',
  REDIS_PORT: '6382',
};

module.exports = {
  apps: [

    // ── NestJS API Backend ────────────────────────────────────────────────────
    // Built by: npx nx build api-backend
    // Output:   dist/apps/api-backend/main.js
    // Nginx:    api.dasanienterprises.com → 127.0.0.1:3200
    {
      name: 'dasani-api',
      script: path.join(ROOT, 'dist/apps/api-backend/main.js'),
      cwd: ROOT,
      instances: 1,
      exec_mode: 'fork',
      node_args: '--max-old-space-size=512',
      env: {
        NODE_ENV: 'production',
        PORT: '3200',
        // Bind to loopback — matches Nginx proxy_pass http://127.0.0.1:3200
        HOST: '127.0.0.1',
        // Secrets resolved from the sourced .env.live at deploy time
        DATABASE_URL: process.env.DATABASE_URL,
        JWT_SECRET: process.env.JWT_SECRET,
        REFRESH_TOKEN_SECRET: process.env.REFRESH_TOKEN_SECRET,
        ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
        // Wasabi S3-compatible storage
        WASABI_ACCESS_KEY_ID: process.env.WASABI_ACCESS_KEY_ID,
        WASABI_SECRET_ACCESS_KEY: process.env.WASABI_SECRET_ACCESS_KEY,
        WASABI_REGION: process.env.WASABI_REGION,
        WASABI_BUCKET: process.env.WASABI_BUCKET,
        WASABI_ENDPOINT: process.env.WASABI_ENDPOINT,
        // Firebase Cloud Messaging (server-side)
        FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
        FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL,
        FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY,
        // WhatsApp — Meta Cloud API. Set WHATSAPP_ENABLED=true in .env.live to activate.
        WHATSAPP_ENABLED: process.env.WHATSAPP_ENABLED || 'false',
        META_WA_ACCESS_TOKEN: process.env.META_WA_ACCESS_TOKEN,
        META_WA_PHONE_NUMBER_ID: process.env.META_WA_PHONE_NUMBER_ID,
        META_WA_API_VERSION: process.env.META_WA_API_VERSION,
        ...infraOverrides,
      },
      error_file: path.join(ROOT, 'logs/dasani-api-error.log'),
      out_file: path.join(ROOT, 'logs/dasani-api-out.log'),
      merge_logs: true,
      time: true,
    },

    // ── Admin Panel (Next.js) ─────────────────────────────────────────────────
    // Built by: npx nx build admin-panel
    // Output:   dist/apps/admin-panel/
    // Nginx:    admin.dasanienterprises.com → 127.0.0.1:4320
    {
      name: 'dasani-admin',
      script: path.join(ROOT, 'node_modules/.bin/next'),
      args: `start ${path.join(ROOT, 'dist/apps/admin-panel')} -p 4320 -H 127.0.0.1`,
      cwd: ROOT,
      instances: 1,
      exec_mode: 'fork',
      node_args: '--max-old-space-size=256',
      env: {
        NODE_ENV: 'production',
        PORT: '4320',
        // HOSTNAME is intentionally omitted — see feedback_deploy_nginx memory:
        // setting it causes Next.js 15+ to build redirect URLs from the bind
        // address instead of the nginx-forwarded Host header.
        NEXT_TELEMETRY_DISABLED: '1',
      },
      error_file: path.join(ROOT, 'logs/dasani-admin-error.log'),
      out_file: path.join(ROOT, 'logs/dasani-admin-out.log'),
      merge_logs: true,
      time: true,
    },

    // ── Vendor Dashboard (Next.js) ────────────────────────────────────────────
    // Built by: npx nx build vendor-dashboard
    // Output:   dist/apps/vendor-dashboard/
    // Nginx:    vendor.dasanienterprises.com → 127.0.0.1:4321
    {
      name: 'dasani-vendor',
      script: path.join(ROOT, 'node_modules/.bin/next'),
      args: `start ${path.join(ROOT, 'dist/apps/vendor-dashboard')} -p 4321 -H 127.0.0.1`,
      cwd: ROOT,
      instances: 1,
      exec_mode: 'fork',
      node_args: '--max-old-space-size=256',
      env: {
        NODE_ENV: 'production',
        PORT: '4321',
        NEXT_TELEMETRY_DISABLED: '1',
      },
      error_file: path.join(ROOT, 'logs/dasani-vendor-error.log'),
      out_file: path.join(ROOT, 'logs/dasani-vendor-out.log'),
      merge_logs: true,
      time: true,
    },

    // ── Customer Portal (Next.js) ─────────────────────────────────────────────
    // Built by: npx nx build customer-portal
    // Output:   dist/apps/customer-portal/
    // Nginx:    app.dasanienterprises.com → 127.0.0.1:4322
    {
      name: 'dasani-app',
      script: path.join(ROOT, 'node_modules/.bin/next'),
      args: `start ${path.join(ROOT, 'dist/apps/customer-portal')} -p 4322 -H 127.0.0.1`,
      cwd: ROOT,
      instances: 1,
      exec_mode: 'fork',
      node_args: '--max-old-space-size=256',
      env: {
        NODE_ENV: 'production',
        PORT: '4322',
        NEXT_TELEMETRY_DISABLED: '1',
      },
      error_file: path.join(ROOT, 'logs/dasani-app-error.log'),
      out_file: path.join(ROOT, 'logs/dasani-app-out.log'),
      merge_logs: true,
      time: true,
    },

  ],
};
