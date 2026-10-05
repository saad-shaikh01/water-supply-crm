# Multi-Vendor Onboarding — Roadmap

**Status: PLANNING** (2026-10-05). Nothing below is implemented yet. This is the agreed
order of work and the intent of each step. **Each step gets its own discussion + detailed
design BEFORE implementation** (see "Working agreement"); the per-step sections here are
starting points, not final designs.

## Goal

Turn the app from "one vendor (Dasani / Blue Ice) with multi-tenant plumbing" into a
product where a new vendor can be onboarded safely: correct permissions on first login,
their own branding on every customer-facing document, their own WhatsApp identity, and
eventually plans/limits/billing.

## Where we are today (audit, 2026-10-05)

Already in place:
- `vendorId` on virtually every table; `Role` is per-vendor.
- `POST /vendors` (SUPER_ADMIN only) creates the `Vendor` + a `VENDOR_ADMIN` user in one
  transaction (`vendor.service.ts#create`). Suspend / unsuspend / reset-admin-password /
  stats endpoints exist.

Gaps (these define the roadmap):
1. **Roles are not seeded on vendor create.** RBAC seeding lives only in
   `libs/shared/database/prisma/rbac-seed.ts` (a script). `UserService.create` looks up
   `Role` by `(vendorId, key)`; none exists → `roleId = null` → empty permission set →
   Access Denied on every page for the new vendor admin.
2. **No default data** for a new vendor (attendance categories, notification settings,
   payroll config, collection policy configs, …).
3. **Customer-facing PDFs hardcode Dasani**: company name, email, website, bank title,
   logo in `delivery-receipt-pdf.service.ts`, `customer-statement-pdf.service.ts`,
   `daily-sheet-pdf.service.ts` (+ a `.debug.ts`).
4. **WhatsApp is global**: `META_WA_ACCESS_TOKEN` / `META_WA_PHONE_NUMBER_ID` env vars, one
   number for the whole platform.
5. **Known cross-tenant risk**: `GET /vendors/:id` comment (C6) says VENDOR_ADMIN is not
   scoped to own vendorId (a C5 fix + spec exist — verify). Full audit never done.
6. **No super-admin UI** for creating/managing vendors (API only).
7. **No plans / limits / billing.**
8. Platform-wide: `User.email` is globally unique; one DB, one Redis, one Wasabi bucket,
   one BullMQ set of queues.

## Order of work

| Step | Feature | Why here |
|---|---|---|
| 1 | Vendor roles auto-seed **+** vendor bootstrap / default data | Same service (`VendorProvisioningService`); fixes the Access-Denied blocker. |
| 2 | Tenant isolation / security audit | Read-only, finds bugs that may reshape later steps; only item that can leak data. Moved up from position 4 of the original list. |
| 3 | Vendor settings + branding (PDFs, company details) | A real vendor cannot go live while PDFs say "DASANI". |
| 4 | Super Admin vendor management UI | Thinner once backend is done. |
| 5 | Per-vendor WhatsApp integration | Largest + riskiest. **Start the business side (Meta number, business verification, template approval — days/weeks) in parallel, early.** |
| 6 | Onboarding wizard | Depends on 1–5. |
| 7 | SaaS features (plans, billing, limits) | Limit-enforcement hooks only make sense once the rest exists. |

## Step intents (starting points — to be refined per step)

### 1. Roles auto-seed + bootstrap
- Extract the seed logic from `rbac-seed.ts` into a reusable, **idempotent** service; call
  it inside the vendor-create transaction (failure rolls back the whole vendor).
- **Backfill existing vendors** (Dasani / Blue Ice) with the same service.
- Make future permission additions sync to every vendor (relates to
  `PRESET_DRIFT_BACKFILLS`).
- Default data per vendor: attendance categories, notification settings, payroll config,
  collection-policy configs, etc. (inventory exactly which tables need rows — to be
  determined by reading the code, not guessed).
- Open questions: should provisioning be re-runnable from the super-admin UI ("repair
  vendor")? Version the bootstrap so later defaults can be applied incrementally?

### 2. Tenant isolation audit
- Every Prisma query in services/processors/controllers: is `vendorId` in the `where`?
  Includes raw SQL, BullMQ processors, cron jobs, portal endpoints, file/Storage keys
  (Wasabi prefixes), cache keys (Redis), WebSocket rooms.
- Verify `GET /vendors/:id` scoping; look for IDOR on `/:id` routes.
- Output: a findings doc (severity-ranked) + fixes + regression specs.

### 3. Vendor settings + branding
- `VendorSettings` (company name, email, website, address, bank details, logo, brand
  colour, invoice footer).
- All three PDF services read from it; **Dasani's current hardcoded values are backfilled
  in the migration so existing PDFs do not change by a single character.**
- Open questions: logo storage (Wasabi key), per-vendor customer-portal branding, currency
  / locale / timezone per vendor?

### 4. Super Admin vendor management UI
- List / create / edit / suspend / reset admin password / view stats; "repair
  provisioning" action from step 1.

### 5. Per-vendor WhatsApp
- Per-vendor credentials stored **encrypted** in DB; provider resolved per vendor.
- **No fallback to the platform number** — a vendor without WhatsApp configured sends
  nothing (otherwise vendor B's customers get messages from Dasani's number).
- Per-vendor templates / approval status, warm-up and batch limits (see the 2026-07-03
  session-ban incident in project memory), webhook routing by phone-number id.

### 6. Onboarding wizard
- Guided first-run for the new vendor admin: company details → branding → products →
  vans/routes → staff → WhatsApp → first customers.

### 7. SaaS features
- Plans, limits (customers / vans / users), enforcement behaviour (block vs warn),
  billing (manual invoicing first, gateway later), usage metering.

## Platform-level concerns (not tied to one step)
- `User.email` global uniqueness (two vendors cannot share an email).
- Shared infra: one DB / Redis / queues → noisy-neighbour risk; per-vendor rate limits.
- Pending, un-applied migrations from sessions S51–S61 must be applied to production
  before onboarding.
- Backups, per-vendor data export, support process, ToS/privacy — business decisions.

## Working agreement
1. Before each step: re-read the relevant code, write a short design (decisions + open
   questions), **discuss with the owner**, then implement.
2. Each step ends with tests + verification, and its own commit (only when the owner asks).
3. Migrations are **never applied** by Claude; the owner applies them.
4. After each step, update this file: status per step + decisions made.

## Step status

| Step | Status | Notes |
|---|---|---|
| 1 | **Implemented (2026-10-05), not committed** | See "Step 1 — decisions & as-built" below. Attendance-category defaults pending owner input. |
| 2 | Not started | |
| 3 | Not started | |
| 4 | Not started | |
| 5 | Not started | |
| 6 | Not started | |
| 7 | Not started | |

## Step 1 — decisions & as-built (2026-10-05)

**Owner decisions:** seed sensible defaults for customer-flag (VIP, Credit Hold, Problem
Customer, High Priority, Commercial) — vendors edit afterwards, no wizard dependency;
notifications stay default-ON, and the *sending layer* (Step 5) will skip + warn the admin
when a vendor has no WhatsApp config; `POST /vendors/:id/provision` repair endpoint;
confirm the suspected FK bug with a real-DB test first, then make vendor creation atomic;
`VendorProvisioningService` handles only mandatory onboarding and does **not** duplicate the
existing lazy defaults.

**Confirmed bug:** `POST /vendors` never worked — `UserService.create` used the global
Prisma client while the vendor row lived uncommitted in the transaction →
`P2003 User_vendorId_fkey`. Reproduced on a real Postgres before the fix.

**As built**
- `libs/shared/authz/src/lib/role-provisioning.ts` — `ensureRole`, `ensureVendorRoles`,
  `VENDOR_ROLE_KEYS`, and `PRESET_DRIFT_BACKFILLS` (moved out of `rbac-seed.ts`; the
  script now calls the same functions). Prisma-free (structural `RoleProvisioningDb`).
  Role + grants are one nested create.
- `vendor/vendor-provisioning.service.ts` — `provisionInTx(tx, vendorId)`: roles + drift
  catch-up, attaches role-less users to their system role, seeds flag categories only when
  the vendor has none. `repair(vendorId, actor)` wraps it, busts the permission cache for
  backfilled users, audits `PROVISION`.
- `VendorService.create` — vendor, provisioning and VENDOR_ADMIN all on one `tx`; admin gets
  the vendor's `vendor_admin` `roleId`. Pre-checks slug + email, maps P2002 to 409. Audit
  after commit. No longer depends on `UserService`.
- `POST /vendors/:id/provision` (super-admin).
- `VendorService.remove` now deletes `CustomerFlagCategory` first (FK is RESTRICT; seeded rows
  would otherwise make a fresh vendor undeletable).
- Tests: `vendor-provisioning.integration.spec.ts` (10 tests, real Postgres, opt-in via
  `TEST_DATABASE_URL`, never falls back to `DATABASE_URL`). `rbac:seed` re-verified on a DB.

**Not seeded / open**
- *Attendance categories:* the proposed list (Present, Absent, Late, Half Day, Paid/Unpaid/Sick
  Leave) does not fit — `AttendanceCategory` is the *reason for a manual PRESENT marking*
  (accepted only with status PRESENT); absences/leave/half-day are statuses, not categories.
  Awaiting a corrected list.
- No migration in this step (no schema change).
- Pre-existing, not touched: `GET /vendors/:id/stats` and `/users` are super-admin only so no
  scoping issue; full tenant audit is Step 2.
