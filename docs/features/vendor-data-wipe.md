# Super-admin: wipe a vendor's data

**Status (2026-10-13): implemented, tested against a throwaway Postgres; not deployed.**

A super admin can remove every row a vendor owns, so the vendor can be set up (or imported) again from
scratch — for example a test / onboarding vendor that went wrong. It is deliberately hard to trigger.

## Where
Admin panel → **Vendors** → the eraser icon on a vendor row (next to Suspend / Reactivate).

API (super admin only):
- `GET  /vendors/:id/wipe/preview` — per-table row counts, what stays, whether a wipe is currently allowed. Changes nothing.
- `POST /vendors/:id/wipe` — body `{ confirmSlug, password, acknowledgeBackup: true, previewToken }`.

## What is removed / what stays
Removed: every customer, delivery sheet, transaction, order, expense, payroll, fleet, cash-ledger, import, notification,
audit… row of the vendor, and **every user except the vendor admin(s)** (drivers, salesmen, staff, customer portal logins).

Stays: the `Vendor` record (name, slug, settings), `VendorBranding`, the vendor's `Role`s + `RolePermission`s, the WhatsApp
sender, and the `VENDOR_ADMIN` login(s) — so the same admin can sign in again and the vendor keeps its identity.

After the wipe the vendor is put back in its "just created" state: `goLiveAt` is cleared, roles and starter catalogues are
re-seeded (same routine as "Repair Vendor Setup"), and the vendor **stays suspended** until you reactivate it.

Not touched: files already uploaded to object storage (Wasabi) and rows of other vendors.

## Safeguards (all must hold)
1. **Switched off by default.** The API refuses unless `VENDOR_WIPE_ENABLED=true` (env, restart needed). Keep it `false` on
   production and enable it only while you reset a test/onboarding vendor.
2. **Protected vendors.** A vendor listed in `WHATSAPP_ALLOWED_VENDOR_IDS` (the legacy / production vendor, e.g. Blue Ice /
   Dasani) can never be wiped, whatever the switch says.
3. **Vendor must be suspended** first (the dialog offers a one-click suspend), so nobody writes while data is removed.
4. **Preview first**, and the wipe is bound to it: `previewToken` is a hash of the per-table counts; if the data changed since
   the preview, the wipe is refused and you must reopen the preview.
5. **Type the vendor slug**, **re-enter the super admin's password** (403 on a typo, so the web client does not log you out),
   and tick **"I have taken a fresh database backup"**.
6. **One transaction** (plus an advisory lock): either everything is removed or nothing is.
7. **Audit:** a `WIPE_VENDOR_DATA` row (with per-table counts) is written *after* the wipe with no `vendorId`, so it survives
   the removal of the vendor's own audit rows. The API log also records start / finish / failure.
8. Throttled (1/s, 3/min).

## How it works
`vendor-wipe.planner.ts` derives everything from the Prisma datamodel — no hand-kept table list:
- a model is **owned** if it has a `vendorId` column, or a *required* relation to an owned model (e.g. `DailySheetItem` →
  `DailySheet`); the row scope is `vendorId = $1` or "parent is in scope";
- optional foreign keys that form a cycle (self-references such as `CustomerGroup.parentId`, reversal links) are nulled first;
- deletes run children-before-parents (topological order); an unresolvable cycle, or a *kept* model that requires a wiped one,
  makes the planner throw — so the unit spec fails at build time instead of the wipe failing at run time.

When a table with a `vendorId` is added later, it is wiped automatically. If you add a model that must survive a wipe, add
it to `KEEP_MODELS` in the planner. `vendor-wipe.planner.spec.ts` checks the invariants against the real schema.

## Testing
- `vendor-wipe.planner.spec.ts` — invariants on the real schema + synthetic edge cases.
- `vendor-wipe.service.spec.ts` — every guard, and that nothing runs unless all pass.
- `scripts/vendor-wipe-check.ts` — end-to-end against a **throwaway** Postgres (refuses any database whose name does not end
  in `test`). Last run: all 99 delete statements executed without FK errors; the wiped vendor kept its vendor record, branding,
  roles and admin; another vendor's rows were untouched; the audit row was written without a `vendorId`.

## Runbook (a test vendor that needs a reset)
1. Take a backup: `bash deploy/backup-db.sh <tenant>` (see `VPS_CRON_SETUP.md`) and check it.
2. Set `VENDOR_WIPE_ENABLED=true` in the tenant's env file, then reload the API with the new env
   (`set -a; source .env.live; set +a; pm2 startOrRestart ecosystem.dasani.config.js --only dasani-api --update-env`).
3. Admin panel → Vendors → eraser → read the preview → suspend → type slug + password + tick backup → **Wipe all data**.
4. Set `VENDOR_WIPE_ENABLED=false` again and reload the API.
5. Re-import the vendor's data (Settings → Data Import), reactivate the vendor, and go live again.

A very large vendor may take longer than the reverse-proxy timeout (nginx default 60 s): the API keeps working and finishes,
but the browser can show a gateway error. Reopen the preview — it shows 0 rows once the wipe is done.
