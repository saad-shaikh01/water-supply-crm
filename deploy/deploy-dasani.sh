#!/usr/bin/env bash
# deploy/deploy-dasani.sh — full production deployment for the DASANI ENTERPRISES
# tenant, in one command. Mirrors deploy/deploy.sh (testinglinq) but targets:
#   - .env.live instead of .env.prod
#   - docker-compose.dasani.yml (dasani-postgres:5435, dasani-redis:6382)
#   - ecosystem.dasani.config.js (dasani-api:3200, dasani-admin:4320,
#     dasani-vendor:4321, dasani-app:4322)
#   - deploy/nginx/dasani-enterprises.conf
#
# This script is meant to run from a SEPARATE clone of this repo
# (e.g. /opt/dasani-crm), NOT the testinglinq checkout — so both tenants can
# be on different commits momentarily if needed, and a bad `git reset --hard`
# in one never touches the other's working tree.
#
# Recommended workflow: always verify a feature on testinglinq
# (deploy/deploy.sh) FIRST. Only once confirmed, pull the same commit here
# and run this script.
#
# Usage:
#   bash deploy/deploy-dasani.sh              # deploys from 'main'
#   bash deploy/deploy-dasani.sh my-branch    # deploys from a specific branch/tag
#
# First-time VPS setup (run ONCE before the first deploy, in this checkout):
#   1. pm2 is already installed globally (shared with testinglinq) — no re-install needed.
#   2. Bring up the data layer once so certbot's http-01 challenge has something
#      listening behind nginx: docker compose --env-file .env.live -f docker-compose.dasani.yml up -d --wait
#   3. Provision SSL: sudo certbot certonly --nginx \
#                       -d api.dasanienterprises.com \
#                       -d admin.dasanienterprises.com \
#                       -d vendor.dasanienterprises.com \
#                       -d app.dasanienterprises.com
#   4. Then run this script normally — nginx will pick up the certs.

set -euo pipefail

BRANCH="${1:-main}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env.live"

# ── 0. Prerequisites ──────────────────────────────────────────────────────────
echo "==> Checking prerequisites..."

if [ ! -f "${ENV_FILE}" ]; then
  echo "ERROR: ${ENV_FILE} not found."
  echo "       Copy .env.live.example → .env.live and populate all values."
  exit 1
fi

for cmd in git node npx docker pm2; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: '${cmd}' is not installed or not in PATH."
    exit 1
  fi
done

# ── Load .env.live into the current shell ─────────────────────────────────────
# All NEXT_PUBLIC_* vars must be in the shell before Nx builds so they are
# baked into the Next.js client bundles at compile time.
set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

# ── Guard: reject placeholder or localhost values in required prod vars ────────
_validate_env() {
  local errors=0
  local name val

  echo "==> Validating required env vars in ${ENV_FILE}..."

  for name in JWT_SECRET DATABASE_URL NEXT_PUBLIC_API_URL ALLOWED_ORIGINS POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB; do
    val="${!name:-}"

    if [ -z "$val" ]; then
      echo "  ERROR: ${name} is not set in ${ENV_FILE}"
      errors=$((errors + 1))
      continue
    fi

    if echo "$val" | grep -qiE 'replace-with|placeholder'; then
      echo "  ERROR: ${name} still contains a placeholder value: ${val}"
      errors=$((errors + 1))
    fi
  done

  # Reject localhost / 127.0.0.1 in URL-type vars
  # (DATABASE_URL is exempt — it legitimately points to 127.0.0.1 for the Docker loopback port)
  for name in NEXT_PUBLIC_API_URL FRONTEND_URL ALLOWED_ORIGINS API_URL; do
    val="${!name:-}"
    if [ -n "$val" ] && echo "$val" | grep -qE 'localhost|127\.0\.0\.1'; then
      echo "  ERROR: ${name} contains localhost — this will break production: ${val}"
      errors=$((errors + 1))
    fi
  done

  # Dasani-specific: DATABASE_URL must point at port 5435 (dasani-postgres),
  # never 5432 (that's wscrm-postgres / testinglinq) — catches a copy-paste
  # mistake from .env.prod early instead of silently writing into the wrong DB.
  if [ -n "${DATABASE_URL:-}" ] && echo "$DATABASE_URL" | grep -q ':5432/'; then
    echo "  ERROR: DATABASE_URL points at port 5432 (testinglinq's Postgres)."
    echo "         Dasani must use port 5435 (dasani-postgres). Fix ${ENV_FILE}."
    errors=$((errors + 1))
  fi

  # Catches the OTHER copy-paste mistake: port 5433 is an unrelated project's
  # sentra_postgres_testing container on this VPS, not dasani-postgres.
  if [ -n "${DATABASE_URL:-}" ] && echo "$DATABASE_URL" | grep -q ':5433/'; then
    echo "  ERROR: DATABASE_URL points at port 5433 — that's sentra_postgres_testing"
    echo "         on this VPS, NOT dasani-postgres. Dasani must use port 5435. Fix ${ENV_FILE}."
    errors=$((errors + 1))
  fi

  if [ "$errors" -gt 0 ]; then
    echo ""
    echo "  Aborting: fix the ${errors} error(s) above in ${ENV_FILE} and re-run."
    exit 1
  fi

  echo "     All required env vars look good."
}

_validate_env

cd "${REPO_ROOT}"

# ── 1. Pull latest code ───────────────────────────────────────────────────────
# .env.live holds live secrets and must never be clobbered by `git reset --hard`,
# regardless of whether it is git-tracked or whether local edits were ever
# pushed to origin. Back it up before the reset and restore it right after.
echo ""
echo "==> [1/8] Pulling latest code (branch: ${BRANCH})..."
cp "${ENV_FILE}" "${ENV_FILE}.deploy-backup"
git fetch origin "${BRANCH}"
git reset --hard "origin/${BRANCH}"
cp "${ENV_FILE}.deploy-backup" "${ENV_FILE}"
rm -f "${ENV_FILE}.deploy-backup"
echo "     .env.live preserved across reset."

# ── 2. Install Node dependencies ──────────────────────────────────────────────
echo ""
echo "==> [2/8] Installing Node.js dependencies..."
npm install --legacy-peer-deps

# ── 3. Data layer ─────────────────────────────────────────────────────────────
echo ""
echo "==> [3/8] Starting Docker data layer (dasani-postgres + dasani-redis)..."
docker compose --env-file "${ENV_FILE}" -f docker-compose.dasani.yml up -d --wait --remove-orphans
echo "     PostgreSQL  →  127.0.0.1:5435"
echo "     Redis       →  127.0.0.1:6382"

# ── Write a minimal .env so Prisma CLI picks up DATABASE_URL ─────────────────
# Prisma CLI always reads from .env in the project root (ignoring shell vars).
# NOTE: This OVERWRITES the repo-root .env — fine here because this script runs
# from Dasani's own separate clone, never the testinglinq checkout.
_DB_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:5435/${POSTGRES_DB}?schema=public"
cat > "${REPO_ROOT}/.env" <<EOF
# Auto-generated by deploy-dasani.sh for Prisma CLI — do not edit manually.
DATABASE_URL="${_DB_URL}"
DIRECT_DATABASE_URL="${_DB_URL}"
EOF
echo "     .env  →  DATABASE_URL written for Prisma CLI (user: ${POSTGRES_USER}, db: ${POSTGRES_DB})"
unset _DB_URL

# ── 4. Database migrations ─────────────────────────────────────────────────────
echo ""
echo "==> [4/8] Running database migrations..."
npx prisma migrate deploy --schema=libs/shared/database/prisma/schema.prisma
npx prisma generate --schema=libs/shared/database/prisma/schema.prisma

# ── 5. Build all applications ─────────────────────────────────────────────────
echo ""
echo "==> [5/8] Building all applications..."
echo "     Resetting Nx cache..."
npx nx reset

echo "     Building api-backend..."
npx nx build api-backend --configuration=production

echo "     Building admin-panel..."
npx nx build admin-panel --configuration=production

echo "     Building vendor-dashboard..."
npx nx build vendor-dashboard --configuration=production

echo "     Syncing vendor-dashboard PWA assets (public/ → dist)..."
cp -r "${REPO_ROOT}/apps/vendor-dashboard/public/." \
      "${REPO_ROOT}/dist/apps/vendor-dashboard/public/"

echo "     Building customer-portal..."
npx nx build customer-portal --configuration=production

# ── 6. Runtime directories ────────────────────────────────────────────────────
echo ""
echo "==> [6/8] Ensuring runtime directories exist..."
mkdir -p "${REPO_ROOT}/logs"
mkdir -p "${REPO_ROOT}/uploads"

# ── 7. Sync nginx config ──────────────────────────────────────────────────────
echo ""
echo "==> [7/8] Syncing nginx config..."
NGINX_CONF="/etc/nginx/sites-available/dasani-enterprises.conf"
NGINX_ENABLED="/etc/nginx/sites-enabled/dasani-enterprises.conf"
CERTBOT_LIVE="/etc/letsencrypt/live"

# All four domains share one SAN certificate stored under the primary domain.
_SAN_CERT="${CERTBOT_LIVE}/api.dasanienterprises.com/fullchain.pem"
if [ ! -f "${_SAN_CERT}" ]; then
  echo ""
  echo "  SSL certificate not found at ${_SAN_CERT}"
  echo "  Run this ONCE on the VPS, then re-run deploy-dasani.sh:"
  echo ""
  echo "    sudo certbot certonly --nginx \\"
  echo "      -d api.dasanienterprises.com \\"
  echo "      -d admin.dasanienterprises.com \\"
  echo "      -d vendor.dasanienterprises.com \\"
  echo "      -d app.dasanienterprises.com"
  exit 1
fi
echo "     SSL cert found: ${_SAN_CERT}"

sudo cp "${REPO_ROOT}/deploy/nginx/dasani-enterprises.conf" "${NGINX_CONF}"
if [ ! -L "${NGINX_ENABLED}" ]; then
  sudo ln -s "${NGINX_CONF}" "${NGINX_ENABLED}"
fi

if ! sudo nginx -t; then
  echo ""
  echo "  ERROR: nginx config test failed — previous config is still active."
  echo "  Fix the error above and re-run deploy-dasani.sh."
  exit 1
fi

sudo nginx -s reload
echo "     nginx reloaded."

# ── 8. PM2 start / reload ─────────────────────────────────────────────────────
echo ""
echo "==> [8/8] Starting / reloading PM2 processes..."
pm2 startOrRestart "${REPO_ROOT}/ecosystem.dasani.config.js" --update-env
pm2 save

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  Dasani deployment complete! (8/8 steps)                  ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
pm2 list
