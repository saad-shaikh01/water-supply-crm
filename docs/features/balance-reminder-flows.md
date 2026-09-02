# Balance Reminder Flows — Implemented State (Phases 0–3)

**Status: IMPLEMENTED (Phases 0–3 complete, reviewed phase-by-phase). Pending only a staging pass
for the two new Meta templates + a real WhatsApp end-to-end (see §7).**

The Vendor Dashboard "Balance Reminders" page (`/dashboard/balance-reminders`) sends WhatsApp
messages to customers about their account balance. It was extended from a single
reminder/statement flow into three send kinds behind one shared pipeline:

| Kind (`ReminderSendKind`) | DTO `sendKind` | What it sends |
|---|---|---|
| `REMINDER` | `reminder` (default) | Balance reminder / monthly statement with a payment request, for customers over a balance threshold. **Unchanged from before Phase 0.** |
| `STATEMENT_ONLY` | `statement_only` | Pure monthly-statement PDF with a neutral cover message — no payment ask, no balance threshold. |
| `WARNING` | `warning` | Text-only overdue-balance warning to customers who already received a statement this cycle and still owe. |

All three are **manual, admin-initiated**. There is no scheduler, no queue, no automatic sending
(see §8).

Code: `apps/api-backend/src/app/modules/balance-reminder/` (service / controller / dto),
`apps/api-backend/src/app/modules/whatsapp/templates/` (template names + submit-ready bodies),
`apps/vendor-dashboard/src/app/dashboard/balance-reminders/page.tsx` +
`apps/vendor-dashboard/src/features/balance-reminders/`.

---

## 1. Architecture at a glance

```
Controller (balance-reminder.controller.ts)
  POST /balance-reminders/send-now        → sendNow()          (balance_reminders:send)
  POST /balance-reminders/send-targeted   → sendTargeted()     (balance_reminders:send)
  POST /balance-reminders/preview         → previewReminders() (balance_reminders:view)
  GET  /balance-reminders/history         → getSendHistory()   (balance_reminders:view)  [+ kind filter]
  GET  /balance-reminders/history/:id     → getSendLogDetail() (balance_reminders:view)
  GET  /balance-reminders/config          → getConfig()        (balance_reminders:view)
  PUT  /balance-reminders/config          → updateConfig()     (balance_reminders:configure)

Service (balance-reminder.service.ts) — one pipeline, three kinds:
  resolveAudience()  | resolveWarningAudience()   → fetch + enrich AudienceCandidate[]  (NO decisions)
  classify()         | classifyWarning()          → pure eligibility verdict            (NO I/O, NO templates)
  runSendJob()                                    → the single send loop
  dispatchMessage()  → sendReminder() | sendStatementOnly() | sendWarning()   (ONLY place a template is chosen)
```

`AudienceCandidate` carries everything a verdict needs (`monthEndBalance`, `financialBalance`,
`createdAt`, `isActive`, plus warning-only `lastStatementSentAt` / `hasPendingPaymentRequest` /
`alreadyWarned` / `onCooldown`). `classify()` never does I/O; `runSendJob()` never picks a
template.

**Per-send log:** every non-dry-run send writes one `ReminderSendLog` row (aggregate counts +
`kind` + a per-customer `details` JSON array of `{ customerId, name, customerCode, phone,
balance, status }`). There is no per-message row (see §8).

**Send mechanics (all kinds):** sequential loop, randomised 5–12 s pause between messages,
mid-batch abort if WhatsApp drops (remaining customers → `skipped-disconnected`), a 23 h
per-customer Redis cooldown key (`balance-reminder-cooldown:<vendorId>:<customerId>`) set on
every successful send, `force` to bypass it.

---

## 2. Phase 0 — Pipeline refactor (behaviour-identical)

**Goal:** collapse the three near-duplicate code paths (`previewReminders`, the eligible-send
loop in `processVendorReminders`, the single/selected loop in `sendTargeted`) into one pipeline,
with **zero observable behaviour change** and no schema change.

- **`resolveAudience(opts)`** — fetch + enrich only. Three internal branches, each a
  field-for-field copy of the original query (preview selects `isActive`/`paymentType`/
  `createdAt` and does not DB-filter them; eligible-send DB-filters `isActive` + `phoneNumber`;
  single/selected fetches by id list). Cooldown is resolved here via one batched Redis pipeline
  only for the preview phase.
- **`classify(candidate, ctx)`** — pure, synchronous, no template/dispatch knowledge. Reproduces
  each original skip ladder exactly (order preserved), keyed by `phase` (`preview` | `send`) and
  `mode`. `would-send` / `skipped-inactive` / `-no-phone` / `-invalid-phone` / `-new-customer` /
  `-low-balance` / `-cooldown` / `-excluded`.
- **`runSendJob(opts)`** — the single send loop: `classify` rungs → dry-run short-circuit →
  connectivity abort → per-customer cooldown (unless `force`) → `dispatch()` → cooldown SET on
  success → `sendDelay()` between customers, never after the last.
- **`resultRow()`** — builds each per-customer row; every row carries a `statementUrl` key
  (`would-send` gets the PDF hint when `includeStatement`, everything else `null`).

`processVendorReminders` keeps its exact positional signature (external-caller safe).
Preserved quirks: the eligible path still **pre-filters** low-balance customers out of the
result set entirely (they never appear in `customers` or `skipped`), while preview reports them
as `skipped-low-balance`; single/selected mode still ignores the balance threshold and
`createdAt`; the empty-`customerIds` `error` envelope; `paymentType` present in the eligible
return shape but absent from single/selected.

**Verification:** 32-test `balance-reminder.service.spec.ts` — passes against **both** the
refactored service and the pre-refactor `HEAD` service (proving equivalence). One real
divergence was caught and fixed during Phase 0: `resultRow` must emit `statementUrl: null` on
`sent`/`failed` rows (matches `HEAD`).

---

## 3. Phase 1 — Statement-only mode

**Goal:** send `monthly_statement_neutral` + PDF to every selected customer **regardless of
balance**, with no payment ask.

- DTOs (`SendNowDto`/`SendTargetedDto`/`PreviewDto`) gain `sendKind?: 'reminder' | 'statement_only'`.
- `resolveSendKind()` maps the DTO string → `ReminderSendKind`.
- `classify()` for `STATEMENT_ONLY`: drops **only** the `skipped-low-balance` rung (every other
  rung unchanged). `processVendorReminders` skips the pre-loop balance filter for
  `STATEMENT_ONLY`. `includeStatement` is forced `true` (persisted + returned as such).
- `dispatchMessage()` → `sendStatementOnly()`: generates the statement PDF, sends
  `monthly_statement_neutral` with `[customerName, monthLabel]` + the PDF document. **No
  plain-text fallback** — if the PDF cannot be generated the customer is recorded
  `skipped-pdf-failed` (counts as skipped, no send, no cooldown SET).
- Master switch: reuses `NotificationType.MONTHLY_STATEMENT` (off → `failed`, consistent with the
  reminder flow).
- Frontend: a "Statement Only" option in the Send Type selector; hides the min-balance +
  bypass-cooldown controls and locks the PDF toggle on.

**Verification:** +13 tests; `REMINDER` behaviour re-verified unchanged; manual 2-customer
dry-run + live (mocked transport) confirms a below-threshold customer is included and only
`monthly_statement_neutral` is used.

---

## 4. Phase 2 — Overdue Warning flow (manual)

**Goal:** an admin-initiated text warning to customers who were sent a statement ≥ N days ago
and still owe ≥ a minimum, at most once per billing month.

### Config — `BalanceReminderConfig` (per vendor, missing row = defaults)
| Field | Default | Meaning |
|---|---|---|
| `warningDelayDays` | 3 | Days after a statement send before a warning may go out (settable 1–14). |
| `warningMinBalance` | 100 | Live outstanding at/above which a warning applies. |
| `autoWarningsEnabled` | false | **Reserved — no auto-run job exists.** Not settable via the API. |

`GET /config` returns the effective config; `PUT /config`
(`UpdateBalanceReminderConfigDto`: `warningDelayDays` 1–14, `warningMinBalance` ≥ 0) upserts —
gated by `balance_reminders:configure` (previously granted to the Accountant preset but enforced
nowhere; now it has a real endpoint).

### Eligibility (`resolveWarningAudience` + `classifyWarning`)
A customer is warned when **all** hold — else the shown skip reason:

- Received a **statement** send this billing month with `status='sent'` — `kind=STATEMENT_ONLY`,
  or `kind=REMINDER` with `includeStatement=true`, `dryRun=false`. Not in this set → absent from
  the audience entirely.
- Active, sendable phone, **not** `isBillingExempt` (all enforced in the query).
- `createdAt < firstDayOfNextMonth(month)` → else `skipped-new-customer`.
- That statement's `createdAt < warningCutoff` → else `skipped-too-soon`. `warningCutoff` is
  `now` **floored to Asia/Karachi midnight** (UTC+5, no DST) minus `warningDelayDays` days — so
  a warning never fires a few hours "early" on the boundary day.
- **Live** `financialBalance ≥ warningMinBalance` → else `skipped-paid`.
- No `PaymentRequest` in `PENDING` / `PROCESSING` → else `skipped-payment-pending`.
- Not already warned this month: no `kind=WARNING` log with `status='sent'` **and** no
  `balance-warning-sent:<vendorId>:<customerId>:<YYYY-MM>` Redis key (35-day TTL, set on every
  successful warning) → else `skipped-already-warned`.
- Plus the shared rungs: `skipped-excluded`, `skipped-invalid-phone`, 23 h cooldown (send loop).

### Send
- `dispatchMessage()` → `sendWarning()`: sends `payment_overdue_warning` (text only, no PDF)
  with `[customerName, liveBalance.toFixed(2)]`.
- Master switch: dedicated `NotificationType.PAYMENT_WARNING` (see decision below). Off →
  `failed`.
- On success `runSendJob` sets **both** the 23 h cooldown key and the warning-month key.
- `ReminderSendLog` row: `kind='WARNING'`, `includeStatement=false`,
  `minBalance=warningMinBalance`.
- `sendNow` / `processVendorReminders` with `kind=WARNING` delegate to the dedicated warning
  path (never the all-customer scan). `mode: single|selected` intersects the statement-recipient
  set with the given `customerIds`.
- Frontend: an "Overdue Warning" Send Type (text-only, hides min-balance / cooldown / PDF
  controls, shows the delay+min summary and a "last warning run this month" line); an **Overdue
  Warning Settings** card (gated by `balance_reminders:configure`); a **confirm speed-bump**
  before sending warnings from the main button (the preview dialog's "Send to N" sends
  directly).

### NotificationType decision — `PAYMENT_WARNING` (not reuse of `MONTHLY_STATEMENT`)
A dedicated `NotificationType.PAYMENT_WARNING` was added so a vendor can keep statements on while
turning warnings off — reusing `MONTHLY_STATEMENT` would conflate "send me statements" with
"warn my customers". Cost was one `ALTER TYPE ADD VALUE` (repo precedent:
`20260819231532_add_delivery_failed_notification_type`). It surfaces as "Overdue Balance
Warning" on the Notification Controls page.

**Verification:** +20 tests (config, `warningCutoff` math, every skip reason incl. both
already-warned sources, send + dual-key SET, master-switch gate, dry-run, delegation).

---

## 5. Phase 3 — History UX polish

**Backend (filter only, no send-behaviour change):**
- `GET /balance-reminders/history` accepts `&kind=REMINDER|STATEMENT_ONLY|WARNING` (invalid →
  ignored). `getSendHistory` adds `where.kind` when given; omitted otherwise (existing callers
  unaffected). Applied to both `findMany` and `count`.

**Frontend:**
- History table: a **Kind** column with a colour-coded badge + an "All Kinds / Reminder /
  Statement / Warning" filter chip row (part of Clear + the empty-state copy).
- Detail dialog: a Kind badge in the context-chip strip.
- **"Re-send to Failed (N)"** button in the detail summary — visible only when `details[]` has
  a `failed` / `skipped-disconnected` row; fires
  `sendTargeted({ sendKind: <mapped from log.kind>, mode: 'selected', customerIds: <those ids>,
  month: <log.month>, force: true })`. This writes a **new** `ReminderSendLog` row and re-runs
  full eligibility (so a customer who has since paid comes back `skipped-paid` on a warning
  re-send).
- **WhatsApp-disconnected guard:** every send action (Send Now / Send Warnings, per-row Send,
  "Send to N", warning-confirm, Re-send to Failed) is disabled when `waStatus.status !==
  'connected'`, with an inline notice. **Preview stays enabled** (sends nothing).
- `useSendTargeted` now invalidates `['reminder-history']` on a non-dry-run success so the list
  refreshes after a send / re-send.

**Verification:** +3 tests (`where.kind` present with a filter, absent without, combines with
date + result). Manual: history with/without `kind` returns the right rows and `where`; re-send
extracts only non-delivered ids and targets exactly those.

---

## 6. Migrations added (all additive)

| Migration | Contents |
|---|---|
| `20260903000000_add_reminder_send_kind` | `CREATE TYPE "ReminderSendKind" AS ENUM ('REMINDER', 'STATEMENT_ONLY')`; `ReminderSendLog.kind` column (`NOT NULL DEFAULT 'REMINDER'` — every existing row backfills to `REMINDER`); index `@@index([vendorId, month, kind])`. |
| `20260903010000_add_reminder_send_kind_warning` | `ALTER TYPE "ReminderSendKind" ADD VALUE 'WARNING'` (standalone). |
| `20260903020000_add_payment_warning_notification_type` | `ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_WARNING'` (standalone). |
| `20260903030000_add_balance_reminder_config` | `CREATE TABLE "BalanceReminderConfig"` (+ unique index on `vendorId`, index, FK to `Vendor` `ON DELETE CASCADE`). |

`ReminderSendKind` was split (create with 2 values, then `ADD VALUE 'WARNING'`) so each
`ADD VALUE` stands alone — each maps 1:1 to the phase that ships it. Apply in order via
`prisma migrate deploy`. Not applied to a DB in the dev environment used for these phases (no
local Postgres); `prisma validate` + `prisma generate` clean throughout.

Schema: new `enum ReminderSendKind`, new `enum NotificationType` value `PAYMENT_WARNING`, new
`model BalanceReminderConfig`, `ReminderSendLog.kind`, `Vendor.balanceReminderConfig` back-relation.

---

## 7. Templates added — **require Meta approval before use**

Both are **UTILITY**, language `en`, submit-ready bodies in
`apps/api-backend/src/app/modules/whatsapp/templates/cloud-api-templates.md` (§4b and §6b).
Until each is **Approved** in WhatsApp Manager, its send path returns a Graph API error and the
message silently fails.

### `monthly_statement_neutral` (Phase 1) — header: Document (PDF)
```
Assalamu Alaikum, {{1}}

Please find your {{2}} statement attached for your records.

Thank you for choosing Blue Ice.
```
`{{1}}` = customer name · `{{2}}` = month (e.g. `September 2026`).

### `payment_overdue_warning` (Phase 2) — text only, no header
```
Assalamu Alaikum, {{1}}

This is a reminder that your account has an outstanding balance of Rs. {{2}} which is still pending.

To avoid any interruption to your scheduled deliveries, please clear the outstanding amount at your earliest convenience.

Thank you for choosing Blue Ice.
```
`{{1}}` = customer name · `{{2}}` = current outstanding balance. Deliberately factual
(service-continuity notice, not a "pay or lose service" marketing message) to keep it
UTILITY-classifiable.

### Full template → kind map
| Kind | Balance | Template | Body params | PDF |
|---|---|---|---|---|
| `reminder` (`includeStatement=true`) | `> 0` / `< 0` / `= 0` | `monthly_statement` / `monthly_statement_advance` / `monthly_statement_clear` | see templates doc | ✅ |
| `reminder` (`includeStatement=false`) | `> 0` / `< 0` / `= 0` | `balance_reminder` / `balance_clear_advance` / `balance_clear` | ✅ (params) | — |
| `statement_only` | any | **`monthly_statement_neutral`** | `[name, monthLabel]` | always |
| `warning` | any (≥ `warningMinBalance`) | **`payment_overdue_warning`** | `[name, liveBalance]` | — |

---

## 8. Known staging requirements / verification gap

Nothing in Phases 1–3 has been verified against a live Meta Graph API — every automated test
stubs `WhatsAppService`. Before go-live:

1. **Submit + get approval** for `monthly_statement_neutral` and `payment_overdue_warning`. If
   `payment_overdue_warning` is rejected or reclassified MARKETING, soften the wording and
   resubmit.
2. **Apply the 4 migrations** on the target env (`prisma migrate deploy`). Confirm the
   `BalanceReminderConfig` table and both new enum values exist.
3. **Notification Controls:** confirm "Overdue Balance Warning" appears and defaults on; toggling
   it off must record every warning recipient as `failed`.
4. **Config RBAC:** the Overdue Warning Settings card + `PUT /config` require
   `balance_reminders:configure` (403 / hidden otherwise).
5. **End-to-end, real number:** send a real statement to a consenting test customer, wait past
   the delay, `POST /preview { sendKind:'warning', mode:'eligible', month }`, then
   `POST /send-targeted { sendKind:'warning', mode:'single', customerIds:[...], month }`.
   Verify: the message arrives with the right name + live balance and no attachment; a
   `ReminderSendLog` row `kind=WARNING`; the `balance-warning-sent:*` Redis key (TTL ~35 d);
   an immediate re-run reports `skipped-already-warned`.
6. **Statement-only E2E:** `POST /send-targeted { sendKind:'statement_only', mode:'single', … }`
   → neutral PDF received, no payment ask, log `kind=STATEMENT_ONLY`.
7. **History / re-send:** in the UI, filter history by kind, open a run with failures, use
   "Re-send to Failed", confirm only the previously-failed customers are targeted and a new row
   appears; disconnect WhatsApp and confirm all send buttons disable while Preview stays live.
8. **Timezone spot-check:** with server tz `Asia/Karachi`, a statement sent at 22:00 PKT on day
   N should not become warn-eligible until day N + `delayDays` local midnight (not
   `delayDays × 24 h` after the timestamp).

---

## 9. Deferred — explicitly NOT built (Phase 4 / 5)

These were designed in the original plan and are intentionally **out of scope**. Do not
implement without a fresh decision:

- **Phase 4 — BullMQ send job.** The send loop is still synchronous and tied to the HTTP
  request; a full ~450-customer run takes ~1 hour and the request times out client-side while
  the loop continues server-side. Moving `runSendJob` into a one-shot BullMQ job (return a
  `jobId`, poll history) is the intended fix and the prerequisite for any automation. The
  Phase 3 "Re-send to Failed" flow is the interim mitigation for partial runs.
- **Phase 4 — `ReminderSendRecipient` normalization.** Per-customer results are kept in the
  `ReminderSendLog.details` JSON array. A dedicated child table (with `providerMsgId` for Meta
  delivery/read webhooks) is the migration path once per-message status tracking is wanted or
  runs routinely exceed a few thousand recipients. Trigger conditions and target shape are in
  the original plan.
- **Phase 5 — Auto-warning scheduler.** `BalanceReminderConfig.autoWarningsEnabled` exists but
  is inert. A nightly `upsertJobScheduler` job running `resolveWarningAudience` per vendor,
  gated by that flag (default off), is deferred until Phase 4 lands and the manual flow is
  proven in production.
- **No other reminder automation** — no cron, no event-driven triggers, no "final notice" or
  pre-delivery reminder kinds.
- **Housekeeping not done:** the dead `ReminderScheduleConfig` model + its migration and
  `scripts/inspect-balance-reminder-schedule.mjs` were left in place — removing them needs a
  destructive `DROP TABLE`, kept out of a feature phase. The stale `/schedule` line in the RBAC
  catalog was corrected to point at `/config`.
