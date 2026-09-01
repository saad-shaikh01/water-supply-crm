# Edit Closed-Sheet Delivery

**Status: IMPLEMENTED (2026-09-02). Backend + frontend + unit tests. No schema
migration — reuses existing `DailySheetItem` columns.**

## 1. Overview

A closed sheet already had three retroactive tools: **Void Delivery** (strike a
stop), **Add Missed Delivery** (`addCorrectionItem` — add a new row), and
**Post-Close Trip Correction** (`correctClosedTrip` — fix trip counts). Missing
was the ability to **directly amend the figures of an already-recorded
delivery** on a closed sheet while keeping it a single delivery row.

**Void-vs-Edit distinction.** Before this feature the only way to fix "driver
logged 5 bottles / ₨500, actually 6 / ₨600" on a closed sheet was Void + Add
Missed Delivery, which splits one delivery into two rows (a voided row plus a
correction row). Edit Closed-Sheet Delivery changes the four numbers in place —
the row stays one delivery, keeps its id, its conversation thread, its history.

## 2. Endpoint

`PATCH /daily-sheets/items/:id/correct`

- Permission: **`daily_sheets:correct`** (Admin-only) — the same gate as Add
  Missed Delivery. No new permission / catalog / seed change.
- Throttle: `{ short: 5/1s, medium: 20/60s }`.
- Declared before `PATCH /daily-sheets/items/:id` so the static suffix wins.
- Body (`CorrectDeliveryDto`): `filledDropped`, `emptyReceived`,
  `filledReceived`, `cashCollected` (`@IsInt @Min(0)`, all required);
  `priceOverride?` (`@IsNumber @Min(0)`); `correctionNote` (required, trimmed,
  3–500 chars).

## 3. Behaviour

- Only `COMPLETED` / `EMPTY_ONLY` items are correctable (they have figures +
  ledger rows). `VOIDED` → 409; any other status → 400.
- **Price:** `price = dto.priceOverride ?? item.pricePerBottle` — the existing
  per-bottle price is kept unless an override is explicitly given. Never
  re-resolved from custom/base price on an edit.
- **Status auto-flip:** `filledDropped === 0` → `EMPTY_ONLY`, otherwise
  `COMPLETED` (mirrors `submitDelivery`).
- **Ledger:** `ledger.recordDelivery()` is called with the item's existing
  `dailySheetItemId`, so `applyIdempotentRepost` posts a signed **delta** —
  adjusts `BottleWallet.balance` + `Customer.financialBalance`, deletes and
  recreates the `DELIVERY` / `PAYMENT` transaction rows. `occurredAt` is the
  original sheet date, so the statement / analytics / portal stay on that day.
- **Concurrency:** `SELECT 1 FROM "DailySheetItem" WHERE id = $1 FOR UPDATE` is
  the first statement inside the `$transaction`; the item's status/`voidedAt`
  are then re-read inside the txn and re-asserted correctable.
- **Negative wallet:** the ledger's `BadRequestException` matching `/negative/i`
  is rethrown as `UnprocessableEntityException` with code
  `CLOSED_DELIVERY_CORRECTION_WALLET_NEGATIVE`. No override path.
- **Skipped gates:** collection-policy, van-stock and unacknowledged-notes gates
  are all skipped — this is a historical correction, exactly like
  `addCorrectionItem`.
- The item is stamped `isCorrection = true`, `correctionNote`,
  `correctionAddedAt`, `editCount += 1`, `lastEditedAt`, and fresh
  `bottleBalanceAfter` / `financialBalanceAfter` snapshots.
- Audit: `AuditLog` `action: 'CLOSED_DELIVERY_CORRECTED'` with `before` / `after`
  figure blocks (`correctionNote` in `after`).
- 3-way cache invalidation (`invalidateDailyDashboard` + `invalidateOverview` +
  `invalidateAnalytics`).

## 4. Accepted divergence

Same as Void Delivery and Post-Close Trip Correction: this endpoint does **not**
touch the frozen close-time `cashExpected` and does **not** re-run
`buildReconciliation` / `createCasesForSheet`. Any close-time discrepancy cases
stay exactly as they were at close.

## 5. Frontend

- `dailySheetsApi.correctClosedDelivery(itemId, body)`.
- `useCorrectClosedDelivery(sheetId)` — `retry: 0`; invalidates
  `sheets.one(sheetId)` + `['sheets']` + `['customer-financial-summary']`; maps
  the 422 code to its backend message.
- `components/dialogs/edit-closed-delivery-dialog.tsx` — "Correct Closed-Sheet
  Delivery": read-only header, amber banner, 4 number inputs pre-filled from the
  item, optional price override, required reason textarea (≥3 chars).
- `delivery-items-list.tsx` — a Pencil "Edit" action shows per row when
  `canCorrectClosedDelivery && isClosed && !isVoided && status ∈ {COMPLETED,
  EMPTY_ONLY}` (the closed-sheet exception to the `!rowsLocked` edit gate, same
  pattern as the Void button).
- `delivery-item-history-dialog.tsx` — `CLOSED_DELIVERY_CORRECTED` → "Corrected",
  shows the before/after figures + `correctionNote`.
