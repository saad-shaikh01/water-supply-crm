# Void Delivery — Living Implementation Document

**Status: IMPLEMENTED — Phases 0–5 complete (2026-09-02). Backend + frontend built;
automated tests written; migration authored but NOT yet applied (local Postgres was
unreachable). Phase 4 senior review returned CHANGES REQUIRED; all seven fixes applied in
Phase 5 (see Change Log 2026-09-02).**

This document is the single source of truth for the Void Delivery feature. It records the
locked product decisions, the full backend/frontend surface, and the manual + regression
checklist QA must walk before this ships. Architectural changes require an explicit revision
approved by the project owner and a Change Log entry.

---

## 1. Overview

**Void Delivery** strikes a recorded stop from the operational record. It is the sanctioned
way to undo a delivery that was recorded in error — wrong sheet, wrong date, a duplicate, a
stop that never actually happened, or a data-entry mistake.

- **Append-only principle.** A void never deletes the `DailySheetItem`. The row's `status`
  flips to `VOIDED`, four metadata columns are stamped (`voidedAt`, `voidedById`,
  `voidReason`, `voidNote`), and an `AuditLog` row (`action: 'DELIVERY_VOIDED'`, with
  `changes.before` / `changes.after`) is written. Every relation that points at the item
  (transactions, conversations, damage cases, delivery issue, move logs) survives.
- **Ledger effect is reversed, not deleted.** For a pre-void status of `COMPLETED` /
  `EMPTY_ONLY` the delivery's ledger effect is reversed by re-posting the item through the
  existing idempotent ledger path with all-zero quantities and cash
  (`LedgerService.recordDelivery({...all zeros}, tx)`). That returns the customer's
  `BottleWallet.balance` and `Customer.financialBalance` to their pre-delivery values and
  removes the `PAYMENT` row. The orchestrator then deletes the leftover zero-value
  `DELIVERY` row so nothing shows on the statement/portal for a delivery that "never
  happened". For `NOT_AVAILABLE` / `RESCHEDULED` / `CANCELLED` there is no ledger effect to
  reverse — the void is an audit-only operational hide.
- **Out of scope.** "Move Delivery" (relocating a stop to a different sheet/date) is
  deferred — the sanctioned recovery workflow is **Void, then re-create** the stop
  correctly (adhoc on an open sheet, Correction Entry on a closed one). There is no
  "un-void". A void mistake is corrected by re-creating the delivery.

---

## 2. Architecture decisions

### 2.1 Locked product decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | **Cash-bearing deliveries are voidable.** A stop with `cashCollected > 0` can be voided; the reversal deletes the `PAYMENT` row and re-inflates `financialBalance` by that cash. | Voiding means "this delivery — and the cash collection tied to it — never happened." If the physical cash was kept, the operator re-books it as a standalone `recordPayment` afterwards. The dialog warns explicitly when cash will be reversed. |
| 2 | **Voiding is allowed on a closed sheet** for holders of `daily_sheets:void_delivery`. The vendor-dashboard exposes the per-row Void trigger on a closed sheet — its gate is `canVoidDelivery && !isMovedOutView && !isVoided && VOIDABLE_STATUSES.includes(status)`, deliberately **not** `!rowsLocked` (which folds in `isClosed`). Edit / unlock / request-edit stay `!rowsLocked`. | Analogous to Correction Entry (the sanctioned closed-sheet mutation). The reversing ledger rows are dated to the sheet's business date, not "today". |
| 3 | **Five voidable statuses:** `COMPLETED`, `EMPTY_ONLY`, `NOT_AVAILABLE`, `RESCHEDULED`, `CANCELLED`. `PENDING` is **not** voidable (nothing has happened yet — mark it not-available or reschedule instead). Already-`VOIDED` is a conflict. | Only the first two carry a ledger effect, so the reversal call runs only for those; the other three flip status + audit only. |
| 4 | **Permission holders: Admin + Manager.** New permission key `daily_sheets:void_delivery`. | Mirrors the trust level of Correction Entry / edit-lock management. `vendor_admin` gets it via the `*` wildcard; `manager` via an explicit `MANAGER_PERMISSIONS` entry + a `PRESET_DRIFT_BACKFILLS.manager` catch-up grant for already-seeded vendors. Staff / Salesman / Driver never get it. |

### 2.2 Orchestrator defaults (locked)

- **`occurredAt` rule for the reversal:** `item.dailySheet.isClosed || item.isCorrection`
  → reversing ledger rows are dated to `sheet.date`; otherwise they post at `now()`.
  (Mirrors `submitDelivery` / `addCorrectionItem`.)
- **Negative-wallet → hard 422, no override.** If the reversal would push the bottle wallet
  below zero (later pickups returned bottles since the delivery), the ledger's
  `BadRequestException` (`/negative/i`) is caught and rethrown as
  `UnprocessableEntityException { code: 'VOID_WOULD_MAKE_WALLET_NEGATIVE' }`. There is no
  "void anyway, let the wallet go negative" path — the operator must resolve the bottle
  balance first.
- **Delete the leftover zero `DELIVERY` txn.** After the all-zero repost,
  `tx.transaction.deleteMany({ dailySheetItemId, type: 'DELIVERY' })` removes the zero row
  the idempotent path leaves behind — the statement/portal show nothing.
- **Unacknowledged-notes gate is bypassed.** A voided item is struck from the record; the
  `requiresAck` block that guards `submitDelivery` does not apply to `voidDelivery`.
- **Dedicated "Voided" tab.** Voided rows are excluded from the "All" tab and every stat
  tile; they surface only in a "Voided" tab that appears once `count > 0`.
- **Concurrency:** the status flip + ledger reversal run inside one `prisma.$transaction`.
  The flip is an **atomic conditional claim** — `tx.dailySheetItem.updateMany({ where: { id,
  voidedAt: null, status: { not: 'VOIDED' } }, data: {…void fields} })` — run *before* any
  ledger work. `claimed.count !== 1` → `ConflictException` and the txn aborts. Two
  concurrent voids race on that `updateMany`: exactly one matches a row; the blocked
  second txn re-evaluates the `where` after the first commits, matches 0 rows, and throws
  `ConflictException` with **no** second ledger touch. (This replaced an earlier plain
  in-txn `findUnique` re-read, which held no row lock — both callers could read `COMPLETED`
  and both run the reversal, double-reversing wallet + `financialBalance`.) `hasLedgerEffect`
  is computed from the **outer** read's status, never from a post-flip read. A throw anywhere
  after the claim (negative-wallet 422 included) rolls the whole txn back, status flip
  included.

---

## 3. Backend surface

- **Endpoint:** `POST /daily-sheets/items/:id/void`
  - `daily-sheet.controller.ts:239` — `@RequirePermissions('daily_sheets:void_delivery')`,
    `@Throttle({ short: {ttl:1000,limit:5}, medium: {ttl:60000,limit:20} })`, declared
    **before** `@Patch('items/:id')` to avoid route shadowing.
- **DTO:** `dto/void-delivery.dto.ts` — `VoidDeliveryDto`
  - `voidReason: DeliveryVoidReason` — always required (`@IsEnum`). Enum:
    `DUPLICATE | WRONG_SHEET | WRONG_DATE | NEVER_HAPPENED | DATA_ENTRY_ERROR | OTHER`.
  - `voidNote?: string` — `@Transform` trims first (so a whitespace-only `"   "` collapses
    to `""` and is rejected by `@MinLength(3)`), then `@MinLength(3) @MaxLength(500)`, made
    **mandatory** by `@ValidateIf(reason === OTHER || voidNote != null)` — required (min 3)
    only when `voidReason === 'OTHER'`, length-checked whenever a non-null value is supplied.
    Loose `!= null` so an explicit `voidNote: null` on a non-OTHER reason is not a spurious
    400.
- **Service method:** `DailySheetService.voidDelivery(user, itemId, dto)` —
  `daily-sheet.service.ts:874`.
  - Tenant check (`findUnique` + `item.dailySheet.vendorId !== vendorId` → `NotFound`).
  - Already-voided (`status === 'VOIDED' || voidedAt`) → `Conflict`.
  - `PENDING` → `BadRequest`. Any status ∉ the 5 voidable → `BadRequest`.
  - `$transaction`, in order: **(1)** atomic claim `tx.dailySheetItem.updateMany({ where: {
    id, voidedAt: null, status: { not: 'VOIDED' } }, data: { status: VOIDED, voidedAt,
    voidedById, voidReason, voidNote } })`; `count !== 1` → `ConflictException`. **(2)** if
    `hasLedgerEffect` (outer status `COMPLETED`/`EMPTY_ONLY`): `tx.transaction.count({
    dailySheetItemId, type: 'DELIVERY' })` — if `> 0`, re-read `pricePerBottle`, call
    `ledger.recordDelivery({...all zeros, pricePerBottle}, tx)` (with `occurredAt` per the
    rule; the recreated zero row is deleted next, so `occurredAt` has no persisted effect
    today — forwarded for parity), catch `/negative/i` → 422, then
    `tx.transaction.deleteMany({ dailySheetItemId, type: 'DELIVERY' })`. If `hasLedgerEffect`
    but the count is `0` (legacy/unlinked item) the ledger call + `deleteMany` are skipped
    (a `logger.warn` is emitted) — the item is still voided by the claim. **(3)** return
    `tx.dailySheetItem.findUnique({ where: { id } })`.
  - After commit: `audit.log('DELIVERY_VOIDED', { before, after })` +
    `invalidateDailyDashboard` / `invalidateOverview` / `invalidateAnalytics`.
- **Shared guard:** `private assertItemNotVoided(item)` (`:853`) — throws `ConflictException`
  on `status === 'VOIDED' || voidedAt`. Called **before** the terminal-status logic in
  `submitDelivery`, `unlockDeliveryEdit`, `requestDeliveryEdit`.
- **`submitDelivery` new guards:** rejects a voided item (`assertItemNotVoided`), rejects
  `dto.status === 'VOIDED'` (`BadRequest`), rejects **any** submit when
  `item.dailySheet.isClosed` (`Conflict`).
- **`bulk-import`:** `applyImportRow` throws `BadRequest` on a voided target item;
  `validateRowFields` (preview) pushes a row error; a `"VOIDED"` status **cell** is already
  rejected by the `['COMPLETED','SKIPPED','FAILED']` allow-list.

### 3.1 Aggregates that now exclude voided items

| Surface | File | What changed |
|---|---|---|
| `buildReconciliation.totalCashRecorded` | `daily-sheet.service.ts:2570` | reducer filters `status !== VOIDED` → `driver.shouldHandIn` / `driver.discrepancy` correct after a cash-bearing void |
| `findAllPaginated._count.items` | `:1218` | excludes voided ("stops") |
| `findAllPaginated.itemCounts.voided` | `:1208` | **new** bucket, counts voided |
| `analytics.getDeliveries` | `analytics.service.ts:223` | `where.status = { not: 'VOIDED' }` → `total` / `completionRate` / `byDay` / DOW exclude voided |
| `analytics.getStaff` | `analytics.service.ts:495` | item include `where: { status: { not: 'VOIDED' } }` |
| `analytics.getFinancials` (delivery-items query) | `analytics.service.ts:97` | `status: { not: 'VOIDED' }` — cash-by-payment-type split |
| `dashboard.getRoutePerformance` | `dashboard.service.ts:290` | item include `where: { status: { not: 'VOIDED' } }` |
| `dashboard.getStaffPerformance` | `dashboard.service.ts:355` | item include `where: { status: { not: 'VOIDED' } }` |
| PDF `drawDeliveryTable` rows + `TOTAL` / `AVG` | `pdf/daily-sheet-pdf.service.ts:264` | `visibleItems = items.filter(status !== 'VOIDED')` passed to the table; the reducers run on that array |
| PDF `drawInfoCard` Stops / GROSS CASH | `pdf/daily-sheet-pdf.service.ts:452` | `nonVoidItems` used for `Stops` and `totalItemCash` |
| `customer-portal.getDeliveries` | `customer-portal.service.ts:205` | `where.status = { not: 'VOIDED' }` — voided stop never in portal history |

Everything else already filtered to `COMPLETED`/`EMPTY_ONLY` allow-lists (`doneItems`,
`activeItems`, CSV delivery-row query, dashboard `in: [...]` filters, PDF `drawSummary` /
`computeTripStats`) and excludes `VOIDED` for free.

---

## 4. Frontend surface (vendor-dashboard)

- **API:** `daily-sheets.api.ts` → `voidDelivery(itemId, { voidReason, voidNote? })`.
- **Hook:** `use-daily-sheets.ts` → `useVoidDelivery(sheetId)` — invalidates
  `sheets.one(sheetId)`, `['sheets']`, `['customer-financial-summary']`; success toast
  "Delivery voided"; `VOID_WOULD_MAKE_WALLET_NEGATIVE` → backend message toast, else generic.
- **Dialog:** `components/dialogs/void-delivery-dialog.tsx` — cloned from
  `correction-entry-dialog.tsx`. Shows customer + product + current status + the figures
  being reversed; destructive banner with a conditional cash-reversal line
  (`cashCollected > 0`) and a conditional closed-sheet line (`isClosed`); reason `<select>`
  (6 values); "reason detail" `<textarea>` required (min 3) only for `OTHER`; confirm button
  `variant="destructive"` "Void Delivery", disabled while pending/invalid; form resets on
  open.
- **Row treatment:** `delivery-items-list.tsx` — voided row gets `opacity-60`, `line-through`
  on the ↓/↑/↺ chips, a secondary line "Voided by {name} · {reason}" (Ban icon, `voidNote`
  in `title=`). All mutating affordances suppressed on a voided row (Record, editable +
  read-only `DeliveryRecordForm`, Edit / Request-Edit / unlock, Move, resend/download
  receipt); Chats open read-only. New per-row "Void" icon button (Ban), sitting in the same
  action cluster as the expand / edit-history chevron, shown when
  `canVoidDelivery && !isMovedOutView && !isVoided && VOIDABLE_STATUSES.includes(status)` —
  intentionally **not** gated on `rowsLocked`/`isClosed`, so a closed-sheet stop can still
  be voided from the UI (locked decision #2). Only `isMovedOutView` (the moved-out mirror
  tab) and the item's own status/voided state hide it.
- **Tab:** `sheet-detail.tsx` + `delivery-items-list.tsx` — `TabKey` gains `'voided'`;
  `tabFilter('all')` changed from `return true` → `return status !== 'VOIDED'`;
  `tabFilter('voided')` matches only `VOIDED`; the "Voided" `TabsTrigger` renders only when
  `tabCount('voided') > 0`. Header "X / Y done" counter excludes voided from both sides.
- **History label:** `delivery-item-history-dialog.tsx` — `ACTION_LABEL` gains
  `DELIVERY_VOIDED: 'Voided'`; a detail block renders `changes.after.voidReason` (readable)
  + `voidNote`.
- **Portal filter:** `customer-portal.service.ts getDeliveries` (backend) — voided stop
  excluded from the customer's portal delivery history.

---

## 5. Manual test checklist

> Each box is a scenario. Do the **Steps**, confirm the **Expected**. Nothing here is
> "already tested" — walk it.

### 5.1 Baseline — existing delivery flows unaffected

- [ ] **Normal delivery record still works.**
  Steps: open an open sheet with an active trip, pick a `PENDING` stop, record
  filledDropped/emptyReceived/cash, Save.
  Expected: status → `COMPLETED` (or `EMPTY_ONLY` if drop = 0), wallet + `financialBalance`
  move, `DELIVERY` (+ `PAYMENT` if cash) txn created, receipt queued. No regression.

- [ ] **Correction delivery still works.**
  Steps: on a **closed** sheet, Add Missed Delivery (Correction Entry) with values.
  Expected: new `isCorrection` item, `status COMPLETED`, ledger posts dated to `sheet.date`,
  audit `CORRECTION_ENTRY_ADDED`.

- [ ] **Adhoc delivery still works.**
  Steps: on an open sheet with an active trip, Add Adhoc Delivery with values.
  Expected: new `ON_DEMAND` item `COMPLETED`, ledger posts at now, audit
  `ADHOC_DELIVERY_ADDED`.

- [ ] **Scheduled delivery still works.**
  Steps: generate sheets for a van/day, verify scheduled stops appear `PENDING` in route
  order; record one.
  Expected: unchanged behavior.

### 5.2 Void — happy paths

- [ ] **Void a `COMPLETED` stop on an OPEN sheet.**
  Steps: as Admin/Manager, on an open sheet, expand a `COMPLETED` stop → Void → pick reason
  `DATA_ENTRY_ERROR` → confirm.
  Expected: row → grey "Voided" pill, `opacity-60`, struck chips, "Voided by {you} ·
  Data entry error" line. Customer `financialBalance` drops by (bill − cash); bottle wallet
  returns to pre-delivery; the item's `DELIVERY` + `PAYMENT` txns are gone (no zero row on
  the statement). Row leaves the "All" tab; a "Voided (1)" tab appears. Stat tiles
  (Delivered / Empty / Cash) unchanged from the post-void state (they already excluded it
  once voided). Audit history shows a "Voided" entry with the reason.

- [ ] **Void a `COMPLETED` stop on a CLOSED sheet.**
  Steps: close a sheet, then as Admin/Manager Void a `COMPLETED` stop on it (reason
  `WRONG_DATE`).
  Expected: succeeds. Reversing `DELIVERY`/`PAYMENT` deletions + wallet/`financialBalance`
  moves are dated to `sheet.date` (check the customer statement / portal transaction date —
  no row jumps to today). Customer balance moves. Statement + portal are clean (no stray
  zero line, no voided stop row).

- [ ] **Void an `EMPTY_ONLY` stop.**
  Steps: void a stop that was `EMPTY_ONLY` (empties collected, no drop).
  Expected: ledger reversal runs (bottle wallet re-inflates by the empties count); status
  → `VOIDED`; audit written.

- [ ] **Void a `NOT_AVAILABLE` / `RESCHEDULED` / `CANCELLED` stop.**
  Steps: void each of the three in turn.
  Expected: **no** ledger movement (customer balance + wallet unchanged), **no** txn
  deletions; status → `VOIDED`; row hides from "All", appears in "Voided"; audit `DELIVERY_VOIDED`
  written.

- [ ] **Void a correction entry.**
  Steps: on a closed sheet with an `isCorrection` `COMPLETED` item, void it.
  Expected: reversal dated to `sheet.date` (correction items backdate on an open sheet too).

### 5.3 Void — rejections

- [ ] **Attempt to void a `PENDING` stop.**
  Steps: expand a `PENDING` stop.
  Expected: no Void button shown (UI); direct `POST .../void` → `400` "A pending delivery
  has not happened yet…".

- [ ] **Attempt to void an already-`VOIDED` stop.**
  Steps: `POST .../void` twice.
  Expected: second call → `409` "This delivery is already voided". Customer balances
  unchanged by the second call.

- [ ] **Negative-wallet case.**
  Steps: find a `COMPLETED` stop that dropped N bottles where the customer's current bottle
  wallet for that product is now `< N` (later pickups returned bottles). Void it.
  Expected: `422` with body `{ code: 'VOID_WOULD_MAKE_WALLET_NEGATIVE' }`; dialog shows a
  clear toast ("Resolve this customer's bottle balance before voiding this delivery.").
  Nothing mutated — status still `COMPLETED`, balances unchanged.

### 5.4 The Aug-17 → Aug-22 end-to-end story (cash re-book)

- [ ] **Void a cash-bearing delivery, then re-create it correctly.**
  Steps:
  1. Aug-17: record a `COMPLETED` stop, bill Rs. 800, cash Rs. 800. Note customer
     `financialBalance` = B.
  2. Aug-22: discover it was keyed on the wrong sheet. Void it (reason `WRONG_SHEET`).
     Confirm `financialBalance` is back to B + 0 net for that stop — specifically it
     **re-inflates by the Rs. 800 cash** and the Rs. 800 charge is removed, netting to the
     pre-Aug-17 value.
  3. Re-create the delivery on the correct sheet (adhoc if open, Correction Entry if
     closed) with the same bill Rs. 800 and cash Rs. 800.
  Expected: after step 3 the customer's `financialBalance` and bottle wallet match what they
  should have been all along; exactly one `DELIVERY` + one `PAYMENT` txn exist for the
  corrected stop; the voided stop carries no txns. Statement + portal show only the
  corrected stop.

### 5.5 Ledger + bottle-wallet math

- [ ] **Ledger reversal math (COMPLETED with cash).**
  Steps: pick a stop: dropped `d`, empties `e`, bill = `d × price`, cash `c`. Record
  pre-void: `BottleWallet.balance = W`, `Customer.financialBalance = F`. Void it.
  Expected: `BottleWallet.balance = W − (d − e)`; `Customer.financialBalance = F − (d×price − c)`;
  the item's `DELIVERY` and `PAYMENT` `Transaction` rows are deleted; no replacement row.

- [ ] **Bottle wallet exact figures (pure pickup).**
  Steps: void an `EMPTY_ONLY` stop where `emptyReceived = 3`.
  Expected: `BottleWallet.balance` increases by 3 (the pickup is undone).

- [ ] **Idempotency of the ledger repost.**
  Steps: (dev) call the reversal path twice on the same item.
  Expected: second call moves no balances (deltas 0); no duplicate txns.

### 5.6 Reporting surfaces

- [ ] **Daily-sheet stats tiles unaffected.**
  Steps: note Delivered / Empty Received / Filled Received / Cash Collected tiles; void a
  `COMPLETED` cash stop; re-check.
  Expected: tiles drop by exactly that stop's contribution (they filter to
  `COMPLETED`/`EMPTY_ONLY`, so a voided item is simply gone). Header "X / Y done" numerator
  and denominator both drop by 1.

- [ ] **Reconciliation preview after a void.**
  Steps: open Reconciliation / Export preview before and after voiding a cash-bearing stop.
  Expected: `driver.shouldHandIn` (total cash recorded) drops by that stop's `cashCollected`;
  `driver.discrepancy` recalculates against it. Bottle/empty discrepancy recompute from the
  now-smaller `activeItems`.

- [ ] **PDF — voided row absent, totals intact.**
  Steps: export the sheet PDF after voiding a `COMPLETED` stop.
  Expected: the voided stop's row does **not** appear in the delivery table; `TOTAL` and
  `AVG PRICE / BOTTLE` lines, `drawInfoCard` **Stops** count and **GROSS CASH COLLECTED**,
  and the `drawSummary` verdict are all computed without it. No "0 bottles / Rs 0" row.

- [ ] **CSV export — voided absent.**
  Steps: export CSV for the date.
  Expected: no row for the voided stop; its previously-linked `PAYMENT` no longer appears
  in the standalone-payment section (it was reversed).

- [ ] **Analytics dashboards.**
  Steps: view Analytics → Deliveries and Dashboard route/staff performance for a range that
  includes a voided stop.
  Expected: `total` / completion-rate / by-day / by-DOW / route + staff performance all
  exclude the voided stop (no artificial dip in completion rate).

### 5.7 History, audit, permissions

- [ ] **History dialog shows "Voided" + reason + note.**
  Steps: open the item history dialog for a voided stop.
  Expected: a "Voided" entry (not the raw `DELIVERY_VOIDED` string), with the readable
  reason and the `voidNote` if present.

- [ ] **Audit log `DELIVERY_VOIDED` entry present.**
  Steps: query `AuditLog` for `entity='DailySheetItem'`, `entityId=<item>`.
  Expected: one `DELIVERY_VOIDED` row, `userId` = the voider, `changes.before` = pre-void
  `{ status, filledDropped, emptyReceived, filledReceived, cashCollected }`, `changes.after`
  = `{ status: 'VOIDED', voidReason, voidNote }`.

- [ ] **Permissions — Admin.**  Expected: sees the Void button, `POST .../void` → 200.
- [ ] **Permissions — Manager.**  Expected: same as Admin (after the drift backfill —
  run `npm run rbac:seed` and bust the Redis permission cache).
- [ ] **Permissions — Staff / Salesman / Driver.**  Expected: **no** Void button in the UI;
  `POST .../void` → `403`.

### 5.8 Edit-lock / bulk-import / move interplay

- [ ] **Attempt to edit after void (blocked).**
  Steps: on a voided stop, try Record / resubmit (`PATCH items/:id` or force-resubmit).
  Expected: `409` "This delivery has been voided and cannot be modified". No ledger work.

- [ ] **Attempt unlock / request-edit after void (blocked).**
  Steps: `POST items/:id/unlock-edit` and (as the assigned driver) `POST
  items/:id/request-edit` on a voided stop.
  Expected: both `409`.

- [ ] **Attempt `submitDelivery` on a closed sheet (blocked).**
  Steps: reopen path aside — with a sheet `isClosed`, `PATCH items/:id` any status.
  Expected: `409` "This sheet is closed. Use Correction Entry…".

- [ ] **Attempt `submitDelivery` with `status: 'VOIDED'` (blocked).**
  Steps: `PATCH items/:id` body `{ status: 'VOIDED', ... }` on a normal open-sheet item.
  Expected: `400` "Use the void action to void a delivery". No status change.

- [ ] **Bulk-import row targeting a voided item (blocked).**
  Steps: build an import file whose row maps to a voided item; run preview + confirm.
  Expected: preview flags a row error; confirm → the row is rejected (`400`), other rows
  unaffected.

- [ ] **Bulk-import `VOIDED` status cell (rejected).**
  Steps: put `VOIDED` in a Status cell.
  Expected: "Status … is not valid" (allow-list is `COMPLETED / SKIPPED / FAILED`).

- [ ] **Move a voided item (blocked).**
  Steps: try to select a voided row for Customer Move.
  Expected: not selectable (UI); `POST .../move` → `409` (`VOIDED` ∉ `MOVE_ELIGIBLE_STATUSES`).

### 5.9 Tenancy + concurrency

- [ ] **Cross-tenant void attempt.**
  Steps: as vendor A, `POST /daily-sheets/items/<vendor-B-item>/void`.
  Expected: `404` "Sheet item not found". Nothing mutated.

- [ ] **Concurrent double-void.**
  Steps: fire two `POST .../void` for the same item near-simultaneously.
  Expected: one succeeds; the other → `409` (in-tx status re-read). Customer balances move
  **once** only.

### 5.10 Customer portal

- [ ] **Voided delivery absent from portal history.**
  Steps: log into the customer portal for a customer with a voided stop; open Deliveries.
  Expected: the voided stop is not listed; the count/pagination reflect its absence.

- [ ] **Portal statement has no stray zero line.**
  Steps: open the portal Transactions / statement PDF for that customer around the void
  date.
  Expected: no "0 bottles / Rs 0" `DELIVERY` line for the voided stop; the reversed
  `PAYMENT` is gone; balance is correct.

### 5.11 Tab visibility

- [ ] **"Voided" tab appears only when count > 0.**
  Steps: on a sheet with zero voided items, confirm no "Voided" tab. Void one; confirm the
  tab appears with "(1)". "All" tab count does **not** include it.

### 5.12 Dialog validation (frontend — no automated FE harness, see §7)

- [ ] Reason is required — confirm disabled until a reason is picked.
- [ ] Reason `OTHER` + empty note → confirm disabled; hint "at least 3 characters".
- [ ] Reason `OTHER` + 2-char note → confirm disabled.
- [ ] Reason `OTHER` + 3-char note → confirm enabled.
- [ ] Non-`OTHER` reason + blank note → confirm enabled; request body omits `voidNote`.
- [ ] Non-`OTHER` reason + typed note → note is sent.
- [ ] `cashCollected > 0` on the item → the cash-reversal warning line renders.
- [ ] `isClosed` sheet → the closed-sheet correction line renders.
- [ ] Success → dialog closes, toast "Delivery voided", row updates without a page reload.
- [ ] Reopen the dialog on a different row → form is reset (no stale reason/note).

---

## 6. Regression checklist (ranked hotlist)

From research §"Regression hotlist" — each is a verifiable check.

- [ ] **1. Ledger `applyIdempotentRepost` — no spurious row / no false negative-wallet.**
  Void an audit-only status (`NOT_AVAILABLE` etc.) → confirm `recordDelivery` is **not**
  called and no zero `DELIVERY` row is created. Void a `COMPLETED` with ample wallet →
  reversal succeeds. Automated: `ledger-record-delivery.spec.ts` "all-zero repost" block +
  `void-delivery.service.spec.ts`.

- [ ] **2. `submitDelivery` closed-sheet guard + `status: 'VOIDED'` reject.**
  A closed sheet rejects every `submitDelivery` (`409`); `dto.status === 'VOIDED'` → `400`.
  Confirm existing open-sheet submit + collection-policy / cash-collection-policy gates
  still pass (their fixtures have no `isClosed` key → guard inert). Automated:
  `void-guards.spec.ts`, `collection-policy-gate.spec.ts`, `cash-collection-policy-gate.spec.ts`.

- [ ] **3. `buildReconciliation.totalCashRecorded` excludes voided cash.**
  Void a cash-bearing stop → `driver.shouldHandIn` / `driver.discrepancy` drop by that
  cash. Automated: `void-aggregates.spec.ts`. Manual: §5.6. Note the divergence risk —
  `cashExpected` persisted at close is **not** recomputed by a post-close void; the live
  reconciliation preview and the stored close-time verdict can disagree (accepted; §7).

- [ ] **4. `analytics.getDeliveries` excludes voided.**
  `where.status = { not: 'VOIDED' }`; `total` / `completionRate` / `byDay` / DOW unaffected
  by a voided stop. Automated: `void-aggregates.spec.ts`.

- [ ] **5. PDF delivery table + `TOTAL` / `AVG` / GROSS CASH / Stops exclude voided.**
  Manual: §5.6 (no light unit test — `generate()` needs a live PDFKit doc).

- [ ] **6. Edit/unlock entrypoints reject a voided item via a check that precedes the
  terminal-status logic.** `assertItemNotVoided` is called before the
  `TERMINAL_STATUSES` allow-list in `unlockDeliveryEdit` and before it in
  `requestDeliveryEdit`. Automated: `void-guards.spec.ts`.

- [ ] **7. `bulk-import.applyImportRow` skips/rejects voided rows + `VOIDED` cell.**
  Manual: §5.8 (no bulk-import spec exists).

- [ ] **8. Frontend `tabFilter('all')` excludes voided; row has a `VOIDED` pill and no live
  action buttons.** Manual: §5.2 / §5.11 / §5.12.

- [ ] **9. `customer-portal.getDeliveries` excludes voided; no zero txn on the statement.**
  Automated: `void-aggregates.spec.ts` (where-clause). Manual: §5.10.

- [ ] **10. `permissions.spec.ts` exact-count assertion bumped (166 → 167); role lists
  updated.** Automated: `nx test authz` (232/232 green).

- [ ] **11. Concurrent double-void writes no misleading second audit / no double reversal.**
  Atomic conditional `updateMany` claim (`where: voidedAt: null`) → the loser matches 0
  rows → `409`, ledger never touched. Automated: `void-delivery.service.spec.ts` "atomic
  claim matches 0 rows".

- [ ] **12. `getItemHistory` label — `DELIVERY_VOIDED` → "Voided".** Manual: §5.7.

---

## 7. Deferred / known issues

- **Migration NOT yet applied.**
  `libs/shared/database/prisma/migrations/20260901020000_add_void_delivery/migration.sql`
  is authored (additive: `ALTER TYPE "DeliveryStatus" ADD VALUE 'VOIDED'`, new
  `DeliveryVoidReason` enum, 4 nullable columns on `DailySheetItem`, FK
  `voidedById → User ON DELETE SET NULL`). `prisma generate` has run (client has the new
  types). Run `npx prisma migrate deploy` (or `migrate dev` locally) when the DB is
  reachable — **the feature is non-functional until this runs.**

- **Pre-existing broken test suites (NOT caused by Void Delivery, NOT touched here).**
  - `daily-sheet-notifications.spec.ts` — fails to compile (4 × TS2345: passes a `string`
    where `submitDelivery` expects `AuthUser`). Broken on clean HEAD.
  - `daily-sheet-generation.spec.ts` — 8 × Nest DI failure (`VehicleCheckService` missing
    at constructor index 14 in the test module). Broken on clean HEAD.
  Both should be fixed independently by the owner; flagged, not addressed in Phase 3.

- **No frontend test harness for `vendor-dashboard`.**
  A leftover `apps/vendor-dashboard/jest.config.cts` + `@testing-library/react` exist, but
  `project.json` has **no `test` target** and there are zero `*.spec.tsx` files. Per the
  Phase 3 scope ("do not scaffold a new frontend test harness"), the dialog-validation and
  tab-exclusion checks are covered in the manual checklist (§5.11 / §5.12) instead.

- **Phase 4 review (senior) — CHANGES REQUIRED, all applied in Phase 5 (2026-09-02).**
  - FIX 1 (HIGH) — closed-sheet void was unreachable in the UI (`canVoidThisItem` gated on
    `!rowsLocked`). Now gated on `!isMovedOutView` only. **Fixed.**
  - FIX 2 (MEDIUM) — concurrent double-void could double-reverse balances (plain in-txn
    `findUnique` re-read, no row lock). Now an atomic conditional `updateMany` claim.
    **Fixed.**
  - FIX 3 (LOW) — whitespace-only `voidNote` for `OTHER` passed `@MinLength(3)`. `@Transform`
    trim added. **Fixed.**
  - FIX 4 (NIT) — `@ValidateIf(... voidNote !== undefined)` made an explicit `null` a
    spurious 400. Loosened to `!= null`. **Fixed.**
  - FIX 5 (LOW) — `hasLedgerEffect` with no existing `DELIVERY` txn threw a confusing raw
    400. Now guarded by `tx.transaction.count(...) > 0`; item still voided, `logger.warn`.
    **Fixed.**
  - FIX 6 / 7 (NIT) — dead `occurredAt` branch kept with an explanatory comment; misleading
    controller routing-order comment corrected. **Fixed.**
  - Left as-is (review classified acceptable): raw `['customer-financial-summary']`
    invalidation key; "Add / Change Location" button on a voided row (mutates the customer,
    not the item).
  - Confirm the Nest exception filter serializes the 422 body as
    `{ code: 'VOID_WOULD_MAKE_WALLET_NEGATIVE', message }` (the hook reads
    `error.response.data.code` / `.message`).
  - Voided items are still narrowed by the active-trip filter (same as every other tab) —
    fine since voided items carry a `dailySheetLoadId`.

- **Post-close reconciliation divergence (accepted).**
  Voiding a `COMPLETED` item on an already-closed sheet shifts the live
  `getReconciliationPreview` and the recomputed PDF bottle/empty discrepancy, but **not**
  the stored `cashExpected` nor the already-created `SheetDiscrepancyCase` rows. The ledger
  stays correct; the close-time snapshot and the live view can disagree. Accepted by the
  orchestrator (Open Question #3) — not a data-integrity bug.
  **Update (2026-09-02):** this divergence is now made legible by the Post-Close Divergence
  Banner (Option C) — see `docs/features/post-close-divergence-banner.md`. `findOne` attaches
  `postCloseDivergence` and `sheet-detail.tsx` shows an informational "Modified after close"
  banner. It changes no figure.

---

## 8. Automated test inventory (Phase 3)

| Spec file | Coverage |
|---|---|
| `apps/api-backend/src/app/modules/transaction/ledger-record-delivery.spec.ts` | **extended** — new "all-zero repost (Void Delivery reversal)" describe: full wallet + `financialBalance` reversal + `PAYMENT` drop + single zero `DELIVERY` row; double-void idempotency (2nd all-zero = no-op); negative-wallet `BadRequest(/negative/)`; informational no-existing-txn fall-through |
| `apps/api-backend/src/app/modules/daily-sheet/void-delivery.service.spec.ts` | **new** — happy `COMPLETED` (tx, atomic `updateMany` claim with `where: voidedAt: null`, ledger all-zero call, `deleteMany`, final `findUnique` return, audit `DELIVERY_VOIDED` before/after, cache trio); supplied `voidNote` stored; `EMPTY_ONLY` reversal; `NOT_AVAILABLE`/`RESCHEDULED`/`CANCELLED` audit-only (no `tx.transaction.count`); `PENDING` → 400; already-VOIDED (status + `voidedAt`) → 409; wrong tenant / missing → 404; closed sheet + `isCorrection` → `occurredAt = sheet.date`; open non-correction → no `occurredAt`; negative-wallet → 422 `VOID_WOULD_MAKE_WALLET_NEGATIVE`; non-negative `BadRequest` not swallowed; **concurrency — atomic claim matches 0 rows → 409, `recordDelivery` never called**; **FIX 5 — `COMPLETED` with 0 `DELIVERY` txn rows → still voided, no `recordDelivery`, no `deleteMany`** |
| `apps/api-backend/src/app/modules/daily-sheet/void-guards.spec.ts` | **new** — `submitDelivery` rejects voided item (409, before ledger), rejects `dto.status === 'VOIDED'` (400), rejects closed-sheet submit (409); `unlockDeliveryEdit` / `requestDeliveryEdit` reject a voided item (409) |
| `apps/api-backend/src/app/modules/daily-sheet/dto/void-delivery.dto.spec.ts` | **new** — valid known reason no note; all 5 non-OTHER reasons no note; missing reason; unknown reason string; `OTHER` no note / 2-char / 3-char; note > 500; non-OTHER + valid optional note; **`OTHER` + whitespace-only `"   "` → invalid (trimmed)**; **non-OTHER + explicit `null` → valid (no spurious 400)** |
| `apps/api-backend/src/app/modules/daily-sheet/void-aggregates.spec.ts` | **new** — `buildReconciliation` excludes voided cash from `shouldHandIn` / `discrepancy`; `findAllPaginated` `_count.items` excludes voided + `itemCounts.voided` counts; `analytics.getDeliveries` `where.status = { not: 'VOIDED' }` + total/completionRate; `customer-portal.getDeliveries` `where.status = { not: 'VOIDED' }` |

**Run:** `npx nx test api-backend --testPathPatterns="modules.daily-sheet"` and
`--testPathPatterns="modules.transaction"`, plus `npx nx test authz`.

---

## 9. Change Log

- **2026-09-01** — Phases 0–3 complete. Backend (`voidDelivery` + guards + aggregate
  exclusions), frontend (dialog, row, tab, history, portal), authz (`daily_sheets:void_delivery`
  key + manager preset + drift backfill), migration authored (unapplied). Phase 3: 5 spec
  files (1 extended, 4 new), this document. Phase 4 review outstanding.

- **2026-09-02** — Phase 4 senior review returned CHANGES REQUIRED; Phase 5 applied all
  seven fixes:
  - **FIX 1 (HIGH)** `delivery-items-list.tsx` `canVoidThisItem` — dropped the `!rowsLocked`
    (= `!isClosed`) gate; now `canVoidDelivery && !isMovedOutView && !isVoided &&
    VOIDABLE_STATUSES.includes(status)`. The Void button already sat with the always-rendered
    expand/history controls, so it now shows on closed sheets. Edit/unlock/request-edit
    unchanged (`!rowsLocked`).
  - **FIX 2 (MEDIUM)** `daily-sheet.service.ts` `voidDelivery` — the in-txn re-assert is now
    an atomic conditional `tx.dailySheetItem.updateMany({ where: { id, voidedAt: null,
    status: { not: 'VOIDED' } }, data: {…void fields} })` at the top of the `$transaction`;
    `count !== 1` → `ConflictException`. `pricePerBottle` re-read via `findUnique` inside the
    ledger branch; trailing `update` dropped; method returns a final `findUnique`.
  - **FIX 3 (LOW)** `void-delivery.dto.ts` — `@Transform` trim on `voidNote` so `"   "` is
    rejected by `@MinLength(3)`.
  - **FIX 4 (NIT)** `void-delivery.dto.ts` — `@ValidateIf` predicate `voidNote !== undefined`
    → `voidNote != null` (explicit `null` on a non-OTHER reason no longer a spurious 400).
  - **FIX 5 (LOW)** `voidDelivery` — `tx.transaction.count({ dailySheetItemId, type:
    'DELIVERY' })` guard; if `hasLedgerEffect` but 0 rows, skip `recordDelivery` +
    `deleteMany` and `logger.warn` — the item is still voided by the claim.
  - **FIX 6 (NIT)** `voidDelivery` — `occurredAt` parity branch kept with a comment noting
    the recreated zero row is deleted so it has no persisted effect today.
  - **FIX 7 (NIT)** `daily-sheet.controller.ts` — corrected the misleading comment about the
    void route needing to precede `@Patch('items/:id')` (distinct verb + path).
  - Tests: `void-delivery.service.spec.ts` rewired to `updateMany` + final `findUnique`,
    concurrency case now asserts claim `count: 0` → `Conflict` with `recordDelivery` never
    called, new FIX-5 case added; `void-delivery.dto.spec.ts` +2 cases (whitespace-only
    `OTHER`, explicit `null`). Review findings #7 (raw invalidation key) and #9 (location
    button) left as-is per the review. Builds green (`api-backend`, `vendor-dashboard`);
    `authz` 232/232.
