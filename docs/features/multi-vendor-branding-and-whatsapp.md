# Multi-Vendor Branding + Per-Vendor WhatsApp — Design

**Status (2026-10-09): P0 committed (6cbdf57). P1 (branding), P2 (per-vendor WhatsApp accounts), P3 (templates, reduced) and P4 (go-live + portal branding) are IMPLEMENTED in the working tree — NOT committed, NOT deployed. See §12–§15 (as-built, deliberate omissions, deploy + smoke-test checklist).**
Covers roadmap steps 3 (branding) and 5 (WhatsApp) of `multi-vendor-onboarding-roadmap.md`, plus
the readiness/go-live part of step 6.

## 1. Why

The app was built when only one vendor (Dasani Enterprises / brand "Blue Ice") existed. A code
audit (2026-10-08) found single-tenant assumptions that now put **wrong information in front of
other vendors' customers**:

| ID | Finding | Severity |
|---|---|---|
| A1 | Bank / Easypaisa details hardcoded in statement + receipt PDFs ("Please make all payments to DASANI ENTERPRISES", Meezan account). Another vendor's customers are told to pay Dasani. | **Critical** (money) |
| A2 | Company name / address / phones / website / email / logo hardcoded in 4 PDFs (statement, receipt, daily-sheet, salary slip; salary slip imports the receipt's constants) + a `.debug.ts` copy | **Critical** |
| A3 | One WhatsApp sender: `META_WA_ACCESS_TOKEN` / `META_WA_PHONE_NUMBER_ID` env; `WhatsAppService` methods carry no `vendorId` | **Critical** |
| A4 | Approved Meta template **bodies** contain "Blue Ice" (14 places in `cloud-api-templates.md`) | **Critical** |
| A5 | Free-text WhatsApp (`queueWhatsApp` → `sendMessage`) still used for order approve/reject/plan/dispatch, ticket reply, payment reversal; texts contain "Blue Ice". Violates the template-only rule and is not delivered outside the 24h window. | High |
| B1 | Notification gate is skipped when caller passes no `vendorId`/`type`; balance-reminder, fleet and payroll-slip call `whatsapp.sendTemplate` directly (no queue, no `NotificationLog`) → no per-vendor audit / metering | High |
| B2 | `GET /whatsapp/status` is global; balance-reminders page shows env var names to vendors | Medium |
| B3 | WhatsApp rate-limit key is per phone only → vendor A's message to a phone silently blocks vendor B's for 60 s | Medium |
| C1 | Customer portal branding (title, logo alt, PWA manifest, logos) is "Blue Ice"; portal does not know the vendor before login | Medium |
| C2 | `Vendor` has only `name/address/logoUrl/raastId`; PDFs ignore them | Medium |
| C3 | `payment-reminder.service.ts:34` uses `add({repeat})` + UTC (house rule: `upsertJobScheduler` + `tz`) — staff push only | Low |

**Checked and NOT an issue:** SMS (stub, never sends), invoice numbering (no global counters;
`customerCode` already unique per vendor), Wasabi keys (all uploads vendor-prefixed), timezone /
currency (all vendors are in Pakistan — deferred), daily-sheet auto-generation (loops all active
vendors with per-vendor try/catch), email sender (staff-only, platform brand is fine).
**Not fully verified:** fleet/tracking/warehouse cron per-vendor behaviour, FCM push content,
vendor delete / offboarding export, `seed.ts` credentials.

Note: WhatsApp is now the **Meta Cloud API** (stateless bearer token). The old whatsapp-web /
puppeteer / QR code is gone.

## 2. Decisions (owner-confirmed 2026-10-08 unless marked ★)

1. **Shared deployment**: one app, one DB, one Redis for all vendors (matches existing `vendorId`
   model). Dasani's separate-stack files are legacy.
2. **Brands are separate vendors.** Blue Ice, Lorem and Dear are three `Vendor`s (own customers,
   vans, data) owned by the same company (Dasani Enterprises).
3. **Per-vendor WhatsApp identity.** Each brand gets its own number, all inside **one** Meta
   Business account / WABA owned by Dasani Enterprises (one business verification). Blue Ice keeps
   its current number. A shared number is allowed only as a temporary, super-admin-set arrangement.
4. **No fallback to a platform number, ever.** A vendor without a ready WhatsApp account sends nothing.
5. **Templates**: per-vendor template sets; brand is in the **template name**
   (`delivery_receipt_lorem`) so Blue Ice's existing approved templates and `CloudTemplateNames`
   do not change. ★ Alternative (brand as `{{n}}` variable) rejected: re-shapes the approved
   Blue Ice templates and sends them back into Meta review.
6. ★ **WhatsApp onboarding is manual first** (vendor/owner supplies System User token + WABA id +
   phone-number-id). Embedded Signup / Tech Provider later (Meta app review takes weeks).
7. ★ We submit templates to the vendor's WABA through the API (token needs
   `whatsapp_business_management`).
8. **Payment details come from the vendor, not from us.** Vendors enter their own bank / wallet /
   Raast details; PDFs print those. Missing details → the payment block is **omitted** (never
   Dasani's, never blank placeholders). See §4.
9. ★ Portal branding by `/{slug}` path first; subdomain later.
10. **One company address for Dasani**: `B-145 block 13 D/1 Gulshan e Iqbal, Karachi.` on every
    Dasani document (daily-sheet PDF's "Korangi Creek Korangi" variant is dropped).
11. Existing Blue Ice behaviour must not change: backward-compatible, backfilled, documents and
    messages identical. Migrations are **never applied to the dev DB** by Claude; verify on a
    throwaway Docker Postgres/Redis (`reference_prisma_migrate_direct_url`). No commit until asked.

## 3. Data model

### 3.1 `VendorBranding` (1:1 with Vendor, `vendorId` PK)

What we collect from the vendor (company profile form in vendor settings; also a step in onboarding):

| Group | Field | Required to go live? | Used by |
|---|---|---|---|
| Identity | `displayName` (brand shown on documents / WhatsApp templates) | **Yes** | all PDFs, templates |
| | `legalName` | No (defaults to displayName) | statement / receipt footer |
| | `tagline` | No | PDF header |
| Contact | `address` | **Yes** | all PDFs |
| | `phones` (≥1, display string) | **Yes** | all PDFs |
| | `email`, `website` | No | statement / receipt / salary slip footer |
| Tax | `ntn`, `strn` | No | invoice-style PDFs when present |
| Look | `logoKey` (Wasabi, private; sentinel `builtin:blue-ice` for Dasani only) | No (no logo → name text only) | PDFs, portal |
| | `iconKey` (small mark for watermark) | No | statement / sheet watermark |
| | `primaryColor`, `accentColor` | No (default navy/red from current theme) | `pdf-theme.util`, portal |
| Payments | `paymentAccounts` (Json, ordered list): `{ kind: BANK\|EASYPAISA\|JAZZCASH\|RAAST, accountTitle, bankName?, accountNumber, iban?, branch?, note? }` | **At least one method** | statement + receipt "Please make all payments to …" block |
| Text | `invoiceFooter` (free text, ≤200 chars) | No | statement / receipt |
| WhatsApp | `waDisplayName` | No | WhatsApp setup screen / template brand text |

`Vendor.raastId`, `address`, `logoUrl` stay (portal uses `raastId`); `VendorBranding` is the
source of truth for documents, with the `Vendor` columns as fallback and migrated in by the backfill.
Validation: bank account numbers / IBAN format-checked; free text length-capped; phones normalised
for display only (WhatsApp phones stay digits-only per `phone.util`).

### 3.2 `WhatsAppAccount` (new; **separate from Vendor** so brands can share or not)

`id`, `ownerLabel` (e.g. "Dasani Enterprises"), `wabaId`, `phoneNumberId`, `displayNumber`,
`encryptedToken` + `tokenIv` + `tokenTag` + `keyVersion`, `status`
(`NOT_CONFIGURED | TEMPLATES_PENDING | READY | TOKEN_INVALID | SUSPENDED`), `qualityRating`,
`messagingTier`, `warmupStartedAt`, `dailyCapOverride`, `lastHealthCheckAt`, timestamps.
`Vendor.whatsappAccountId` (nullable FK). Many vendors → one account is allowed **only when set by
a super admin** (same owner). Default = one account per vendor.

### 3.3 `VendorWhatsAppTemplate`

`(vendorId, templateName)` unique, `metaTemplateId`, `status` (`PENDING | APPROVED | REJECTED |
PAUSED`), `rejectionReason`, `catalogVersion`, `submittedAt`, `lastSyncedAt`. Meta templates live
per-WABA, so brand-suffixed names avoid collisions when brands share a WABA. Dasani/Blue Ice
rows are backfilled `APPROVED` with the existing un-suffixed names.

### 3.4 Template catalogue (code)

`templates/catalog.ts`: each entry = base name, category, header type, body text with `{{brand}}`
placeholder (literal substitution at submit time, **not** a Meta variable), sample values,
`catalogVersion`. Resolver: `templateNameFor(vendor, base)` → `base` for Blue Ice (legacy),
`${base}_${vendor.slug-ish}` for others. `CloudTemplateNames` stays the list of *base* names.

## 4. Payment details & branding rendering rules

- A single `VendorBrandingService.get(vendorId)` (Redis-cached, busted on update) returns a
  resolved `Branding` object. Every PDF service takes it as an input and loads it **once per
  document**; logo buffers cached by `(vendorId, logo updatedAt)`.
- **Never default to Dasani values for another vendor.** Missing field → omit the element:
  - no payment accounts → no "make all payments to" block at all;
  - no logo → company name text only;
  - no phones/email/website → that footer line is skipped.
- Required-for-go-live fields (§3.1) are enforced by the readiness check (§7), so a live vendor
  always has a name, address, phone and ≥1 payment method.
- Statement / receipt payment block renders **all** configured accounts (order = vendor's order),
  using the existing layout; the hardcoded `BANK_*` / `EASYPAISA_NO` constants are deleted.
- Portal "pay via Raast" instructions keep using the vendor's `raastId`/Raast entry.
- Salary slip, daily sheet (internal) get identity from the same service; salary slip no longer
  imports constants from `delivery-receipt-pdf.service.ts`.

### Dasani backfill (so nothing changes)
Migration inserts the Dasani `VendorBranding` row with the **exact current strings**:
name `DASANI ENTERPRISES`, address `B-145 block 13 D/1 Gulshan e Iqbal, Karachi.`, phones
`Cell# 0316-2677954, 0345-2364698`, website `blueice.com.pk`, email `info@blueice.com.pk`, payment
accounts = Meezan (`DASANI ENTERPRISES`, `9933-0104414597`) + Easypaisa `03162677954`, logo/icon =
`builtin:blue-ice`. Lorem / Dear / any other vendor get **no** row until the vendor fills it.

### Safety nets
- **Golden test:** render Dasani statement, receipt, salary slip and daily-sheet PDFs on the old
  code and the new code; extract text and assert equality (only the daily-sheet address line differs, per decision 10).
- **CI guard:** a jest test greps `apps/**/src` for `DASANI`, `Blue Ice`, `blueice`, `Meezan`,
  `9933-`, `0316-2677954` outside an allow-list (backfill SQL, templates catalogue legacy entry,
  specs) and fails on new hits.

## 5. WhatsApp design

### 5.1 Send path
`WhatsAppService.sendTemplate(vendorId, phone, baseName, params, doc?, image?)` — `vendorId` is
the first, **mandatory** argument (the compiler finds all ~15 callers). Steps:
1. Resolve vendor → `WhatsAppAccount`; not `READY` → **skip + log** (`NotificationLog` SKIPPED,
   reason `WHATSAPP_NOT_CONFIGURED` / `TEMPLATE_NOT_APPROVED` / `NOT_LIVE`). **Not queued** (queued
   messages would burst out with stale dates once configured). Failed rows remain retryable from the log page.
2. Resolve template name via the catalogue + check `VendorWhatsAppTemplate.status = APPROVED`.
3. Per-vendor throttle (§5.4), rate-limit key becomes `whatsapp:ratelimit:{vendorId}:{phone}` (fixes B3).
4. Provider called with the account's decrypted token / phone-number-id (decrypted in memory
   only, short-lived cache; never logged, never returned by any API).

Free-text `sendMessage` is removed from customer flows (A5). Fleet / payroll / balance-reminder
sends go through the same vendor-aware path, so `NotificationLog` always gets a `vendorId` (fixes B1).

### 5.2 Credentials
AES-256-GCM, master key from env/KMS (`WHATSAPP_TOKEN_KEY`, versioned). Token is **write-only**
in API/UI. Rotation: vendor admin or super admin pastes a new token. Daily health-check job per
account (`GET /{phone-number-id}`): error 190 → `TOKEN_INVALID` + admin notification; also pulls
quality rating / tier.

### 5.3 Webhook
One platform endpoint (signature-verified with the Meta app secret), routed by `phone_number_id`:
delivery/read/failed statuses → `NotificationLog`; `message_template_status_update` →
`VendorWhatsAppTemplate`; quality updates → `WhatsAppAccount`. Template status also polled as a
fallback.

### 5.4 Warm-up and throttling (2026-07-03 incident lesson)
New account: day 1–2 ≤ 20/day in batches of 10; day 3–5 ≤ 50; week 2 ≤ 150; then the Meta tier.
Per-vendor Redis token bucket; randomized 5–12 s delay kept (never a static interval); bulk
sends abort mid-loop if the account leaves `READY`. The incident was a whatsapp-web session;
Cloud API does not log out, but quality rating still degrades with burst volume. *Meta's current
tier / portfolio-level limit numbers must be re-verified against Meta docs when implementing.*

### 5.5 Status & UI
`GET /whatsapp/status` becomes vendor-scoped (own account status, template approval counts,
today's usage / cap). Env var names removed from vendor-facing text (B2). Super admin sees all accounts.

## 6. Customer portal (C1)
Phase 4: public `GET /portal/public/branding/:slug` (name, logo URL, colours only — no private
data); portal routes under `/{slug}`; dynamic web manifest; login page uses slug branding.
Dasani keeps today's look via the backfilled branding. Subdomains can be added later without redoing this.

## 7. Onboarding readiness + go-live
`GET /vendors/me/readiness` (computed, not stored). Items: company profile required fields,
≥1 payment method, ≥1 product, ≥1 van/route, staff roles, customers imported (Data Import),
WhatsApp account `READY`, templates approved (n/N), test message sent, notification settings
reviewed. `goLiveAt` set by the vendor admin when all *required* items pass. **Before go-live
customer-facing WhatsApp and customer-facing PDFs are blocked.** Data Import page gets a stepper card;
super admin sees every vendor's readiness.

## 8. Phases

| Phase | Scope | Rough effort |
|---|---|---|
| **P0 — stop-gap** (no schema change) | `vendorId` mandatory on `WhatsAppService`; **fail-closed allow-list** (`WHATSAPP_ALLOWED_VENDOR_IDS`, env) so only Dasani/Blue Ice sends today; non-listed vendors skip + log. Statement/receipt PDFs for non-Dasani vendors print the vendor's own `Vendor.name/address` and **omit** the payment block until P1 supplies their details. | ~1 day |
| **P1 — Branding** | `VendorBranding` + service + cache, settings API + form (company profile & payment accounts; **super admin can fill it on behalf of any vendor** — owner-confirmed 2026-10-08), 4 PDFs refactored, Dasani backfill, golden tests, CI guard | 3–4 days |
| **P2 — WhatsApp accounts** | `WhatsAppAccount`, encrypted store, per-account provider, health-check, vendor-scoped status + settings UI, replace allow-list with config-based gate, Dasani env→DB backfill | 4–5 days |
| **P3 — Templates** | catalogue + naming resolver, auto-submit, status sync + webhook, warm-up / throttle, `NotificationLog` webhook statuses | 4–5 days (+ Meta review wait) |
| **P4 — Onboarding + portal** | readiness endpoint, go-live gate, stepper card, portal slug branding, dynamic manifest | 3–4 days |
| **Parallel** | A5: move free-text order/ticket/payment-reversal sends onto templates (first verify the `order_*`/`ticket_replied` templates are approved) | 1–2 days |
| **Later** | plans / limits / billing, vendor data export / offboarding, Embedded Signup | — |

Business-side work to start now (it gates P3): Meta business verification for Dasani Enterprises,
SIMs for Lorem and Dear numbers, number registration in the shared WABA.

## 9. Verification (per phase)
- Unit specs for resolvers (branding fallback, template naming, send-gate decisions) and PDF text output.
- Real-Postgres integration spec (opt-in via `TEST_DATABASE_URL`, never `DATABASE_URL`) for
  backfill + vendor isolation (vendor A's token/branding never read for vendor B).
- Throwaway Docker Postgres + Redis for migrations; Meta calls mocked (a fake Graph server), no real sends.
- Existing Blue Ice: golden PDF comparison + a dry-run send through the new path asserting the same template name and params.

## 10. Risks / open items
- P0 means other vendors' customers get **no** WhatsApp until P2/P3 are done — vendors must be told.
- Template approval time and possible Utility→Marketing reclassification by Meta are outside our control.
- Allow-list env is a temporary control; it is deleted in P2.
- Free-text A5 flows may already be silently failing for Dasani today; confirm before P-parallel work.
- Unverified audit areas listed in §1 must be checked during P2/P4.
- Update memory notes (S17 describes the removed whatsapp-web setup) once this design is approved.

## 11. Blue Ice continuity (hard requirement)

Blue Ice (Dasani) WhatsApp messages and documents must never stop or change because of this work.
The risk is real: P0 is fail-closed and P2 moves credentials from env to DB. Rules:

1. **Shadow mode first (P0).** The send guard first runs in log-only mode (`WHATSAPP_GUARD_MODE=shadow`):
   it logs "would block vendor X" but blocks nothing. Enforce (`enforce`) only after at least one
   full day of logs shows zero would-block decisions for Blue Ice (incl. balance-reminder, fleet,
   payroll-slip, queue jobs).
2. **Order of deploy (P0):** set `WHATSAPP_ALLOWED_VENDOR_IDS` (Blue Ice vendor id) in production
   env **before** deploying the code. App start logs an error if the allow-list is empty in
   enforce mode.
3. **Per-caller tests:** every `WhatsAppService` caller has a spec asserting that, for the
   Blue Ice vendor id, the same template name and the same body params reach the provider as before.
4. **Env fallback for Blue Ice only (P2):** the DB-backed account is tried first; if it is missing,
   undecryptable or errors, Blue Ice (and only Blue Ice's vendor id) falls back to the legacy
   `META_WA_*` env path. The env path is removed only after the DB path has run in production for
   an agreed period with no fallbacks logged.
5. **Health-check is observe-only for Blue Ice (P2):** it can alert, it cannot flip Blue Ice to
   `TOKEN_INVALID` / block sends until proven.
6. **Template status for Blue Ice (P3):** rows backfilled `APPROVED`, un-suffixed names unchanged
   (`delivery_receipt`, `monthly_statement`, …). The sync job is read-only; the template gate is
   not enforced for Blue Ice until the sync has been accurate for a week.
7. **No warm-up caps on Blue Ice (P3):** Blue Ice's account is created as warm-up complete; bulk
   reminders (~450 customers) keep today's randomized 5–12 s pacing and are not capped.
8. **Kill switch:** `MULTI_VENDOR_WHATSAPP=off` bypasses the new resolver/gate and restores the
   legacy single-account path without a migration revert.
9. **Additive schema only:** new tables / nullable columns, so old code keeps working against the
   new schema and a code rollback is safe.
10. **Canary after every deploy:** send Blue Ice's real templates (delivery receipt, statement,
    reminder) to an owner-controlled number and confirm receipt before declaring the deploy good.
11. **PDFs:** golden-text comparison of Blue Ice's statement / receipt / salary slip / daily-sheet
    before vs after (only the daily-sheet address line changes, decision 10).

## 12. P0 as built (2026-10-08, uncommitted)

- `common/tenant-gate/legacy-vendor-gate.ts` — env gate (`WHATSAPP_GUARD_MODE` shadow|enforce|off, default **shadow**;
  `WHATSAPP_ALLOWED_VENDOR_IDS`). Read at call time; throttled logging; startup log + error if enforce with an empty list.
- `WhatsAppService` — `vendorId` is now the first argument of `sendTemplate / sendMessage / sendDocument / sendBulk`
  (all ~15 callers updated: notification processor, balance-reminder, fleet alerts, payroll slips); rate-limit key is per vendor+phone (B3);
  `isBlockedForVendor()` for precise log reasons.
- `NotificationProcessor` — passes `job.data.vendorId`; a gated job is recorded FAILED with
  "WhatsApp not enabled for this vendor yet…" (no retry storm; retryable from the log page later).
- `common/pdf/doc-branding.ts` + statement / receipt PDFs — non-allow-listed vendors (enforce only) get a neutral banner
  (own name + address), **no** logo/watermark, **no** Dasani phones/website/email and **no** payment block.
  Legacy path (no `branding`) is untouched. Salary slip / daily-sheet PDFs are NOT changed in P0 (P1).
- Specs: gate, WhatsAppService, doc-branding, statement + receipt PDF text (legacy vs neutral), processor (per job type, fail-closed),
  and updated balance-reminder / payroll-slip expectations. No schema change, no migration.
- **Deploy order:** (1) set `WHATSAPP_ALLOWED_VENDOR_IDS=<Blue Ice vendor id>` and `WHATSAPP_GUARD_MODE=shadow` in `.env.live`;
  (2) deploy; (3) watch logs ≥ 1 full day for `would BLOCK … vendor=<Blue Ice id>` or `MISSING_VENDOR_ID` (must be zero for Blue Ice);
  (4) switch to `enforce`; (5) canary: send Blue Ice's real templates to an owner number. Kill switch: `WHATSAPP_GUARD_MODE=off`.

## 13. P1 as built (2026-10-09, uncommitted)

- **Schema:** `VendorBranding` (1:1, cascade) — migration `20261009000000_add_vendor_branding`, which also **backfills Blue Ice**
  (slug `blue-ice`) with the exact strings its documents have always printed (+ `builtin:blue-ice` logo/icon sentinels).
  Verified on a throwaway Postgres: applies cleanly, no schema drift for the new table, only `blue-ice` gets a row.
  `tagline` and `waDisplayName` from §3.1 were dropped (nothing renders them yet); `strn` kept.
- **Rendering:** `DocBranding` (name, payTo, address, phones, email, website, taxLine, logo, icon, gradient, paymentAccounts, footerNote)
  is the single input of all four PDFs. Statement / receipt / salary slip / daily sheet no longer hold any company constant.
  Payment block draws any number of accounts (BANK / EASYPAISA / JAZZCASH / RAAST); the A5 receipt shows the first two
  (no IBAN row) and points to the statement for the rest, because the legacy layout has no spare vertical room (extra rows
  made pdfkit spill onto extra pages — covered by a test). Missing data => the element is omitted, never defaulted.
- **Resolution:** `VendorBrandingService.resolveForDocs()` — row => row; no row + gate not blocking (default shadow / allow-listed) =>
  legacy Dasani values (so Blue Ice can never degrade, even if its slug is not `blue-ice` or the table is unreachable); no row +
  enforce + other vendor => neutral (own name/address only). 60 s per-vendor cache, busted on save; logo downloads cached by key.
- **API:** vendor admin `GET/PUT /company-profile`, `POST /company-profile/preview?doc=statement|receipt` (draft -> sample PDF),
  `POST|DELETE /company-profile/image/:kind`; super admin: same under `/vendors/:vendorId/branding`.
  New permission resource `company_profile` {page, view, update} (224 total) — Vendor Admin via `*`, withheld from Viewer.
  DTO rejects text the PDF fonts cannot print (Urdu/emoji), validates IBAN/colours/email, caps 6 accounts; images must be real PNG/JPEG ≤ 1 MB (magic-byte check).
- **UI:** Settings -> Company Profile (`/dashboard/company-profile`): Business info / Logo & colours / Payment accounts tabs,
  required-before-go-live banner, "Preview statement / receipt" from the unsaved draft, super-admin vendor picker.
- **Safety nets:** `pdf-golden.spec` (Blue Ice statement/receipt/salary-slip/daily-sheet text identical to the pre-refactor fixture;
  only the daily-sheet address line changed, decision 10), `tenant-hardcode-guard.spec` (no Dasani details in app code except
  `legacy-dasani-branding.ts`), `vendor-branding-render.spec` (a non-Dasani vendor's four documents carry only its own data and
  the receipt stays one page), real-Postgres `vendor-branding.integration.spec` (opt-in via `TEST_DATABASE_URL`), DTO, service, module-wiring specs.
- **Known limitation (closed in P3, §14):** WhatsApp template bodies carried "Blue Ice"; the template catalogue now renders each vendor's own brand.

## 14. P2–P4 as built (2026-10-09, uncommitted) and what was deliberately NOT built

### P2 — per-vendor WhatsApp accounts
- **Schema:** `WhatsAppAccount` (WABA id, phone-number id UNIQUE, token AES-256-GCM `tokenCipher/Iv/Tag/keyVersion`, status
  `NOT_CONFIGURED|READY|TOKEN_INVALID|SUSPENDED`, quality rating, `templateSuffix`, `templatesSyncedAt`) + `Vendor.whatsappAccountId`
  (FK SET NULL). Separate from `Vendor` so sister brands can share one sender (platform admin links them).
  Migration `20261009010000_add_whatsapp_account`.
- **Routing (`WhatsAppAccountService.routeFor`)** — every send: (1) the vendor's own READY account → its credentials; (2) else the
  platform env credentials **only** while the P0 gate lets the vendor through (default `shadow`, `off`, or the legacy allow-list);
  (3) else blocked. A broken/undecryptable account therefore degrades Blue Ice to the env path but never opens the platform number
  to anyone else. Blue Ice with no account row behaves byte-for-byte as before.
- **Credentials:** `PUT /whatsapp/account` verifies the token with Meta FIRST (`GET /{phone-number-id}`), then stores it encrypted;
  write-only (never returned/logged/audited). `WHATSAPP_TOKEN_KEY` (32-byte b64/hex, versioned `_V<n>` for rotation) is required —
  without it the API answers 503 and nothing is stored. Daily health job (`whatsapp-health` queue, 03:10 PKT) re-verifies every
  account: 401/code 190 => `TOKEN_INVALID`; transient errors keep the status.
- **Super admin:** `/vendors/:id/whatsapp-account` (get/connect/verify/disconnect/link/import-platform/settings/templates),
  `GET /platform/whatsapp-accounts`. `import-platform` copies the env credentials into an encrypted account for a vendor — how Blue Ice
  can move env to DB without pasting a token (optional; Blue Ice works without it).
- **Fixes folded in:** vendor-scoped `GET /whatsapp/status` (no env-var names, no platform status leak — B2); bulk loops
  (balance reminders, salary slips) now ask `isReadyFor(vendorId)` instead of the platform-only `isReady()`; rate-limit key per vendor+phone (B3).
- **UI:** Settings -> WhatsApp (connect form, status, verify/disconnect, shared-sender notice, super-admin link/import tools).
  New permission `whatsapp:page` (225 total).

### P3 (reduced) — templates
- `templates/template-catalog.ts`: the 22 templates with Blue Ice's approved bodies and a `{{brand}}` placeholder; spec asserts
  variables/samples match, no hardcoded company, Blue Ice's `delivery_receipt` body is reproduced exactly.
- Names: plain for the first brand on a WABA, `<name>_<suffix>` for further brands (`WhatsAppAccount.templateSuffix`, unique per WABA).
  `WhatsAppTemplate` mirrors Meta's review status via a **read-only** sync (`GET /{waba}/message_templates`), on demand and daily.
  After a sync, a template Meta is known not to have approved is **skipped with a log line** instead of failing at Meta; Blue Ice
  (allow-list) is exempt from this gate. UI: Settings -> WhatsApp -> "Message templates" (status per template, exact name/body to copy).
- **NOT built (deliberate):** (a) auto-submitting templates to Meta — document/image-header templates need the Resumable Upload API
  (a Meta App id/secret) and cannot be validated without a real WABA, so submission stays manual with copy-ready text; (b) Meta
  webhook (delivery/read/quality/template-status push) — polling covers template status, a public signed endpoint is extra surface;
  (c) hard warm-up daily caps — Cloud API enforces its own messaging tiers and a hard cap would silently drop legitimate receipts;
  revisit if a vendor's quality rating drops.

### P4 — onboarding + portal
- `Vendor.goLiveAt` (migration `20261009020000_add_vendor_go_live`; **every existing vendor is backfilled as live**, only vendors
  created afterwards start not-live). `GET /onboarding/readiness` (computed checklist: company profile, payment accounts, products
  [required]; WhatsApp number, required templates approved [required]; vans/routes, customers [recommended]) and
  `POST /onboarding/go-live` (refused while a required item is open; platform admin may force; audited). While the gate **enforces**
  and a non-allow-listed vendor is not live, no customer-facing WhatsApp leaves (default `shadow` changes nothing).
  Platform: `GET /platform/onboarding` (progress of every vendor), `POST /vendors/:id/go-live|go-offline`, `GET /vendors/:id/readiness`.
  UI: "Get ready to go live" card on Data Import / Company Profile / WhatsApp pages (hidden once live — Blue Ice never sees it).
- Portal: `GET /portal/branding` (signed-in customer's vendor: name, logo, colours) -> header shows the vendor's logo/name and sets the
  tab title (never guesses a brand while loading); Blue Ice keeps its bundled artwork (flag `builtinLogo`, also set when it has no
  profile row but is allow-listed). `GET /portal/payment-info` gains `accounts` (the vendor's own payment accounts — additive) and the
  payment dialog lists them. Public `GET /portal/public/branding/:slug` exists for a future slug login link.
- **NOT built:** `/{slug}` portal routing and dynamic PWA manifest/icons (the manifest and favicon stay Blue Ice's; they appear only in
  "Add to home screen"). The login page has no logo today, so nothing wrong is shown there.

### Operational notes / known gaps
- **A5 is still open:** order / ticket / payment-reversal messages still go as free text (`queueWhatsApp`), which Cloud API delivers
  only inside a 24 h window. The approved templates exist (`order_*`, `ticket_replied`) but are not wired; wiring would START
  delivering messages Blue Ice customers have not been receiving, so it needs an explicit owner decision.
- `payment_recorded_corrected` has no catalogue entry (its approved body is not recorded in `cloud-api-templates.md`).
- The customer-statement `.debug.ts` dev script keeps the Dasani constants (allow-listed in the hardcode guard).

## 15. Deploy + smoke-test checklist (run in this order)

1. **Env (server `.env.live`)** — before the code:
   `WHATSAPP_ALLOWED_VENDOR_IDS=<Blue Ice vendor id>`, `WHATSAPP_GUARD_MODE=shadow`, `WHATSAPP_TOKEN_KEY=<32-byte base64>` (keep a backup of it!).
2. **Migrations** — apply all pending ones (S51-S65 + `20261008000000_add_transaction_history_import`, then `20261009000000_add_vendor_branding`,
   `20261009010000_add_whatsapp_account`, `20261009020000_add_vendor_go_live`). The three new ones are additive and were applied from scratch,
   together with the full chain, on a throwaway Postgres; `add_vendor_branding` backfills the vendor with slug `blue-ice`,
   `add_vendor_go_live` marks every existing vendor live.
3. **Deploy** API + vendor-dashboard + customer-portal.
4. **Blue Ice smoke test (nothing may change):** open a statement PDF and a delivery receipt for a Blue Ice customer and compare with an old one
   (same header, logo, Meezan/Easypaisa block); send one real receipt + one balance reminder to your own phone; Settings -> Company Profile shows the
   Dasani details; portal login as a Blue Ice customer shows the Blue Ice logo; no "Get ready to go live" card appears.
5. **Watch logs for at least 1 day** for `[shadow] would BLOCK ... vendor=<Blue Ice id>` / `MISSING_VENDOR_ID` (must be none), then set
   `WHATSAPP_GUARD_MODE=enforce` and repeat step 4.
6. **New-vendor smoke test:** a test vendor -> Company Profile (fill + preview statement/receipt) -> Settings -> WhatsApp (connect a test number;
   copy templates; Refresh status) -> checklist -> Go live. Before "Go live" a reminder/receipt for that vendor is skipped (Notification Logs show
   the reason); its PDFs carry only that vendor's details.
7. **Kill switch** if anything misbehaves: `WHATSAPP_GUARD_MODE=off` + restart (legacy single-number behaviour; PDFs keep the DB profile).
