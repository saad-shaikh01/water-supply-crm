'use strict';

// PM2 ecosystem config — runs all application processes on the host.
// Docker only manages the data layer (PostgreSQL + Redis); see docker-compose.prod.yml.
//
// Prerequisites on the VPS:
//   npm install -g pm2
//   pm2 startup   # generates the systemd/init script for auto-start on reboot
//
// Deploy / reload:
//   bash deploy/deploy.sh          # full build + reload (recommended)
//   pm2 startOrRestart ecosystem.config.js --update-env   # reload only
//
// Env vars are read from the shell environment at the time pm2 is invoked.
// The deploy script sources .env.prod before calling pm2 so all secrets are
// captured and survive process restarts.
//
// IMPORTANT — .env.prod DATABASE_URL must point to 127.0.0.1, NOT the Docker
// service name "postgres":
//   DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/dbname?schema=public

const path = require('path');
const ROOT = __dirname;

// Infrastructure addresses differ between Docker (DNS service names) and the
// host (loopback). Hard-code the host values here so they are always correct
// regardless of what .env.prod says for REDIS_HOST / REDIS_URL.
const infraOverrides = {
  REDIS_URL: 'redis://127.0.0.1:6379',
  REDIS_HOST: '127.0.0.1',
  REDIS_PORT: '6379',
};

module.exports = {
  apps: [

    // ── NestJS API Backend ────────────────────────────────────────────────────
    // Built by: npx nx build api-backend
    // Output:   dist/apps/api-backend/main.js
    {
      name: 'wscrm-api',
      script: path.join(ROOT, 'dist/apps/api-backend/main.js'),
      cwd: ROOT,
      instances: 1,
      exec_mode: 'fork',
      node_args: '--max-old-space-size=512',
      env: {
        NODE_ENV: 'production',
        PORT: '3100',
        // Bind to loopback — matches Nginx proxy_pass http://127.0.0.1:3100
        HOST: '127.0.0.1',
        // Secrets resolved from the sourced .env.prod at deploy time
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
        // WhatsApp — set WHATSAPP_ENABLED=true in .env.prod to activate
        WHATSAPP_ENABLED: process.env.WHATSAPP_ENABLED || 'false',
        WHATSAPP_SESSION_PATH: path.join(ROOT, 'uploads/whatsapp-session'),
        CHROMIUM_PATH: process.env.CHROMIUM_PATH || '/usr/bin/chromium-browser',
        PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: 'true',
        ...infraOverrides,
      },
      error_file: path.join(ROOT, 'logs/wscrm-api-error.log'),
      out_file: path.join(ROOT, 'logs/wscrm-api-out.log'),
      merge_logs: true,
      time: true,
    },

    // ── Admin Panel (Next.js) ─────────────────────────────────────────────────
    // Built by: npx nx build admin-panel
    // Output:   dist/apps/admin-panel/
    // Nginx:    admin.testinglinq.com → 127.0.0.1:4310
    {
      name: 'wscrm-admin',
      script: path.join(ROOT, 'node_modules/.bin/next'),
      args: `start ${path.join(ROOT, 'dist/apps/admin-panel')} -p 4310 -H 127.0.0.1`,
      cwd: ROOT,
      instances: 1,
      exec_mode: 'fork',
      node_args: '--max-old-space-size=256',
      env: {
        NODE_ENV: 'production',
        PORT: '4310',
        HOSTNAME: '127.0.0.1',
        NEXT_TELEMETRY_DISABLED: '1',
      },
      error_file: path.join(ROOT, 'logs/wscrm-admin-error.log'),
      out_file: path.join(ROOT, 'logs/wscrm-admin-out.log'),
      merge_logs: true,
      time: true,
    },

    // ── Vendor Dashboard (Next.js) ────────────────────────────────────────────
    // Built by: npx nx build vendor-dashboard
    // Output:   dist/apps/vendor-dashboard/
    // Nginx:    vendor.testinglinq.com → 127.0.0.1:4311
    {
      name: 'wscrm-vendor',
      script: path.join(ROOT, 'node_modules/.bin/next'),
      args: `start ${path.join(ROOT, 'dist/apps/vendor-dashboard')} -p 4311 -H 127.0.0.1`,
      cwd: ROOT,
      instances: 1,
      exec_mode: 'fork',
      node_args: '--max-old-space-size=256',
      env: {
        NODE_ENV: 'production',
        PORT: '4311',
        HOSTNAME: '127.0.0.1',
        NEXT_TELEMETRY_DISABLED: '1',
      },
      error_file: path.join(ROOT, 'logs/wscrm-vendor-error.log'),
      out_file: path.join(ROOT, 'logs/wscrm-vendor-out.log'),
      merge_logs: true,
      time: true,
    },

    // ── Customer Portal (Next.js) ─────────────────────────────────────────────
    // Built by: npx nx build customer-portal
    // Output:   dist/apps/customer-portal/
    // Nginx:    portal.testinglinq.com → 127.0.0.1:4312
    {
      name: 'wscrm-portal',
      script: path.join(ROOT, 'node_modules/.bin/next'),
      args: `start ${path.join(ROOT, 'dist/apps/customer-portal')} -p 4312 -H 127.0.0.1`,
      cwd: ROOT,
      instances: 1,
      exec_mode: 'fork',
      node_args: '--max-old-space-size=256',
      env: {
        NODE_ENV: 'production',
        PORT: '4312',
        HOSTNAME: '127.0.0.1',
        NEXT_TELEMETRY_DISABLED: '1',
      },
      error_file: path.join(ROOT, 'logs/wscrm-portal-error.log'),
      out_file: path.join(ROOT, 'logs/wscrm-portal-out.log'),
      merge_logs: true,
      time: true,
    },

  ],
};
