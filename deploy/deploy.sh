#!/usr/bin/env bash
# deploy/deploy.sh — full production deployment in one command.
#
# What it does (in order):
#   1. Validates prerequisites and the .env.prod file
#   2. Pulls the latest code from Git
#   3. Installs / updates Node dependencies
#   4. Brings up the Docker data layer (PostgreSQL + Redis) and waits for health
#   5. Runs pending Prisma migrations
#   6. Builds all Nx applications for production
#   7. Ensures runtime directories exist
#   8. Starts or hot-reloads all PM2 processes with the refreshed env vars
#
# Usage:
#   bash deploy/deploy.sh              # deploys from 'main'
#   bash deploy/deploy.sh my-branch    # deploys from a specific branch
#
# First-time VPS setup (run once, not part of this script):
#   npm install -g pm2
#   pm2 startup   # follow the printed command to enable auto-start on reboot

set -euo pipefail

BRANCH="${1:-main}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env.prod"

# ── 0. Prerequisites ──────────────────────────────────────────────────────────
echo "==> Checking prerequisites..."

if [ ! -f "${ENV_FILE}" ]; then
  echo "ERROR: ${ENV_FILE} not found."
  echo "       Create it from .env.example and populate all required values."
  echo "       DATABASE_URL must use 127.0.0.1 (not the Docker service name)."
  exit 1
fi

for cmd in git node npx docker pm2; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: '${cmd}' is not installed or not in PATH."
    exit 1
  fi
done

# ── Load .env.prod into the current shell ─────────────────────────────────────
# This makes NEXT_PUBLIC_* vars available at build time and all secrets
# available to pm2 when it captures the environment via --update-env.
set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

cd "${REPO_ROOT}"

# ── 1. Pull latest code ───────────────────────────────────────────────────────
echo ""
echo "==> [1/7] Pulling latest code (branch: ${BRANCH})..."
git fetch origin "${BRANCH}"
git reset --hard "origin/${BRANCH}"

# ── 2. Install Node dependencies ──────────────────────────────────────────────
echo ""
echo "==> [2/7] Installing Node.js dependencies..."
npm ci --prefer-offline

# ── 3. Data layer ─────────────────────────────────────────────────────────────
echo ""
echo "==> [3/7] Starting Docker data layer (PostgreSQL + Redis)..."
# --wait blocks until both healthchecks pass, so migrations run against a live DB
docker compose -f docker-compose.prod.yml up -d --wait --remove-orphans
echo "     PostgreSQL  →  127.0.0.1:5432"
echo "     Redis       →  127.0.0.1:6379"

# ── Write .env so Prisma picks up the correct DATABASE_URL ───────────────────
# Prisma always reads from .env (ignoring shell vars), so we generate it from
# the POSTGRES_* values already sourced from .env.prod above.
_DB_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${POSTGRES_DB}?schema=public"
cat > "${REPO_ROOT}/.env" <<EOF
DATABASE_URL="${_DB_URL}"
DIRECT_DATABASE_URL="${_DB_URL}"
EOF
echo "     .env  →  DATABASE_URL written (user: ${POSTGRES_USER}, db: ${POSTGRES_DB})"
unset _DB_URL

# ── 4. Database migrations ─────────────────────────────────────────────────────
echo ""
echo "==> [4/7] Running database migrations..."
npx prisma migrate deploy --schema=libs/shared/database/prisma/schema.prisma
# Regenerate Prisma client for the host Node.js runtime (not the Alpine Docker one)
npx prisma generate --schema=libs/shared/database/prisma/schema.prisma

# ── 5. Build all applications ─────────────────────────────────────────────────
echo ""
echo "==> [5/7] Building all applications (one at a time)..."
# NEXT_PUBLIC_* vars from .env.prod are now in the environment and will be
# baked into the Next.js client bundles during this step.
echo "     Building api-backend..."
npx nx build api-backend --configuration=production

echo "     Building admin-panel..."
npx nx build admin-panel --configuration=production

echo "     Building vendor-dashboard..."
npx nx build vendor-dashboard --configuration=production

echo "     Building customer-portal..."
npx nx build customer-portal --configuration=production

# ── 6. Runtime directories ────────────────────────────────────────────────────
echo ""
echo "==> [6/7] Ensuring runtime directories exist..."
mkdir -p "${REPO_ROOT}/logs"
mkdir -p "${REPO_ROOT}/uploads"
mkdir -p "${REPO_ROOT}/uploads/whatsapp-session"

# ── 7. PM2 start / reload ─────────────────────────────────────────────────────
echo ""
echo "==> [7/7] Starting / reloading PM2 processes..."
# startOrRestart: starts the process if it does not yet exist in PM2's list,
# or performs a hard restart (fork mode) / graceful reload (cluster mode) if
# it is already running.  --update-env pushes the current shell env to each
# running process so secrets are refreshed without a full stop/start.
pm2 startOrRestart "${REPO_ROOT}/ecosystem.config.js" --update-env

# Persist the process list so PM2 restores everything after a reboot.
pm2 save

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  Deployment complete!                                    ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
pm2 list
