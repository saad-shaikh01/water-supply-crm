#!/usr/bin/env bash
# deploy/backup-db.sh — daily PostgreSQL backup: dump -> gzip -> upload to
# Wasabi -> prune backups older than RETENTION_DAYS (local + remote).
#
# Runs entirely on the host, decoupled from the API's PM2 process (which is
# memory-capped at 512MB) — safe even if the app is crashed/restarting.
# Uses `docker exec` against the wscrm-postgres container, which already
# ships pg_dump — no extra host packages required.
#
# First-time VPS setup (run ONCE):
#   1. Make executable:  chmod +x deploy/backup-db.sh
#   2. Add to crontab (`crontab -e`), 2:30 AM local server time — chosen to
#      run ~2.5h after the 00:05 AM PKT daily-sheet auto-generation job so
#      the two don't contend for DB/CPU:
#        30 2 * * * cd /path/to/water-supply-crm && bash deploy/backup-db.sh >> logs/backup.log 2>&1
#      NOTE: crontab times are the VPS's LOCAL timezone, not PKT — check
#      with `timedatectl`, and adjust the hour (or prefix `CRON_TZ=Asia/Karachi`
#      if your cron daemon supports it) so this actually lands at 2:30 AM PKT.
#
# Restore a backup (disaster recovery):
#   gunzip -c backups/wscrm-<timestamp>.sql.gz | docker exec -i wscrm-postgres psql -U "$POSTGRES_USER" "$POSTGRES_DB"

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env.prod"
BACKUP_DIR="${REPO_ROOT}/backups"
RETENTION_DAYS=7
CONTAINER_NAME="wscrm-postgres"

if [ ! -f "${ENV_FILE}" ]; then
  echo "ERROR: ${ENV_FILE} not found."
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

for name in POSTGRES_USER POSTGRES_DB; do
  if [ -z "${!name:-}" ]; then
    echo "ERROR: ${name} is not set in ${ENV_FILE}"
    exit 1
  fi
done

mkdir -p "${BACKUP_DIR}"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
DUMP_FILE="${BACKUP_DIR}/wscrm-${TIMESTAMP}.sql.gz"

echo "==> Dumping ${POSTGRES_DB} from ${CONTAINER_NAME}..."
docker exec "${CONTAINER_NAME}" pg_dump -U "${POSTGRES_USER}" "${POSTGRES_DB}" | gzip > "${DUMP_FILE}"
echo "     Dump written: ${DUMP_FILE} ($(du -h "${DUMP_FILE}" | cut -f1))"

echo "==> Uploading to Wasabi..."
node "${REPO_ROOT}/deploy/backup-upload.mjs" "${DUMP_FILE}" "${POSTGRES_DB}"

echo "==> Pruning local backups older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}" -name 'wscrm-*.sql.gz' -mtime "+${RETENTION_DAYS}" -print -delete

echo "==> Backup complete: ${DUMP_FILE}"
