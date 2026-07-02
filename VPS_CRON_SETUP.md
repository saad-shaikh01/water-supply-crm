# VPS Cron Jobs Setup

This project has two automated background jobs that need to run in production. Follow these steps **after** `deploy/deploy.sh` has been run successfully at least once (i.e. the app is already live).

---

## 1. Daily Sheet Auto-Generation

**No VPS setup needed for this one.** It runs *inside* the API app itself (BullMQ repeatable job), not as an OS-level cron job.

- It self-schedules automatically the moment the API process (`wscrm-api` under PM2) starts up — see `apps/api-backend/src/app/modules/daily-sheet/daily-sheet.service.ts` (`onModuleInit` → `scheduleAutoGeneration()`).
- It fires every day at **00:05 AM PKT** and generates that day's delivery sheets for every active vendor (skipping any van with no customers scheduled that day).
- **How to confirm it's active on the VPS**: after deploying/restarting the app, check the logs:
  ```bash
  pm2 logs wscrm-api --lines 50 | grep "auto-generation"
  ```
  You should see:
  ```
  Daily sheet auto-generation scheduled (5 19 * * * UTC)
  ```
  This log line only appears the **first time** the job gets registered (it dedupes on restart via `getRepeatableJobs()`), so if you restart the app again and don't see the line, that's expected — it means the schedule is already in place.
- Nothing to add to crontab. Nothing to install. It just works as long as `wscrm-api` is running under PM2.

---

## 2. Database Backup (PostgreSQL → Wasabi)

This one **does** need a real crontab entry on the VPS, since it must keep running even if the API app crashes or restarts.

### Step 1 — Confirm prerequisites are already in `.env.prod`

These should already be set from your normal deploy (`.env.prod` at repo root) — nothing new to add:
```
POSTGRES_USER=...
POSTGRES_DB=...
WASABI_ACCESS_KEY_ID=...
WASABI_SECRET_ACCESS_KEY=...
WASABI_REGION=...
WASABI_BUCKET=...
WASABI_ENDPOINT=...
```

### Step 2 — Make the backup script executable

```bash
cd /path/to/water-supply-crm
chmod +x deploy/backup-db.sh
```

### Step 3 — Test it manually once

```bash
bash deploy/backup-db.sh
```

Expected output ends with something like:
```
==> Backup complete: /path/to/water-supply-crm/backups/wscrm-20260703-023000.sql.gz
```

If it fails, check:
- `docker ps` — confirm the `wscrm-postgres` container is running.
- `.env.prod` — confirm `POSTGRES_USER` / `POSTGRES_DB` match what the container was created with.
- `node -v` — script needs Node available on PATH (already true since PM2/Node apps run on this host).

Then verify the file actually landed in Wasabi: log into your Wasabi console → the configured `WASABI_BUCKET` → look under the `db-backups/` folder.

### Step 4 — Check the VPS's timezone

```bash
timedatectl
```

The crontab entry below is written assuming the VPS clock is **UTC**. If it isn't, adjust the hour so the job actually lands around 2:30 AM Pakistan Time (PKT = UTC+5) — i.e. run it at `21:30` server time if the server is UTC.

### Step 5 — Add the crontab entry

```bash
crontab -e
```

Add this line (adjust the path and the hour per Step 4):

```
30 21 * * * cd /path/to/water-supply-crm && bash deploy/backup-db.sh >> logs/backup.log 2>&1
```

This runs daily, ~2.5 hours after the 00:05 AM PKT daily-sheet job, so the two don't compete for DB/CPU at the same moment.

### Step 6 — Confirm it's scheduled

```bash
crontab -l
```

You should see the line you just added.

### What this job does automatically

- Dumps the database (`docker exec wscrm-postgres pg_dump ...`), gzips it, uploads it to Wasabi under `db-backups/`.
- Deletes backups older than **7 days**, both locally (in `backups/`) and remotely (in Wasabi).
- Logs every run to `logs/backup.log` — check this periodically (or `tail -f logs/backup.log` right after a scheduled run) to make sure it's still succeeding.

### Restoring a backup (disaster recovery)

```bash
gunzip -c backups/wscrm-<timestamp>.sql.gz | docker exec -i wscrm-postgres psql -U "$POSTGRES_USER" "$POSTGRES_DB"
```

(Or download the equivalent file from the Wasabi `db-backups/` folder first if the local copy has already been pruned.)

---

## Summary Checklist

- [ ] Daily sheet generation — nothing to do, confirm via `pm2 logs wscrm-api | grep auto-generation`
- [ ] `chmod +x deploy/backup-db.sh`
- [ ] Manually run `bash deploy/backup-db.sh` once, confirm success + object appears in Wasabi
- [ ] `timedatectl` → confirm server timezone, adjust cron hour if not UTC
- [ ] `crontab -e` → add the backup line
- [ ] `crontab -l` → confirm it's saved
- [ ] Check `logs/backup.log` the next morning to confirm the first automatic run succeeded
