# Walk-in / Self-Pickup Delivery — Living Implementation Document

**Status: IMPLEMENTED — backend + frontend built (2026-09-04). Migration
`20260904000000_add_walk_in_delivery` authored but NOT applied (local Postgres
unreachable) — runs on next `prisma migrate deploy`. RBAC preset drift-backfill
grants `manager` the new permission on existing vendors at next `rbac-seed` run.**

This document is the single source of truth for the Walk-in Delivery feature. It records the
locked product decisions and the intended backend/frontend surface. Architectural changes
require an explicit revision approved by the project owner and a Change Log entry.

---

## 1. Overview

Today a delivery can only be recorded through the **route pipeline**: a per-van `DailySheet`
is generated for the day → crew is confirmed → a load is taken out (odometer + trip) →
`submitDelivery` records each stop. There is no way to record a delivery that happened
**off-route** — a customer who self-collects bottles from the plant/shop, or a delivery made
through some other channel — without faking a van, an odometer reading and a trip.

**Walk-in Delivery** adds a lightweight "Record Delivery" action, parallel to the existing
"Record Payment" action, that captures only what a counter sale needs (customer, product,
quantities, cash, date, channel, note) and posts it to the ledger exactly like any other
delivery — no van, no odometer, no load-out, no trip, no crew confirmation.

### 1.1 Chosen approach — synthetic per-day walk-in sheet (lazy)

Rather than a standalone ledger row, each walk-in delivery is recorded as a real
`DailySheetItem` on a **synthetic `DailySheet` of `kind = WALK_IN`**, one per vendor per
calendar date, **created lazily on first use**. This is deliberately the heavier option
because it makes every downstream capability work with zero extra code:

- **Edit / Void / Resend-receipt** — the item flows through the existing
  `edit-closed-delivery` and `void-delivery` features unchanged.
- **Statement / portal / analytics** — a walk-in delivery is a `Transaction` of
  `type = DELIVERY` linked to a `dailySheetItemId`, so it already appears everywhere a
  route delivery does.
- **Ledger math** — `LedgerService.recordDelivery()` is reused verbatim (bottle wallet +
  `financialBalance` movement, optional `PAYMENT` row for cash).

The cost is one synthetic sheet row per vendor per active day. A single `kind` flag keeps it
out of every route-oriented surface (see §3).

---

## 2. Locked product decisions

| # | Decision | Detail |
|---|---|---|
| 1 | **Synthetic walk-in sheet, lazy-created.** | No nightly generation. The first walk-in delivery for a `(vendorId, date)` creates the `kind = WALK_IN` sheet inside the same transaction (`findFirst` → create if missing). Days with no walk-ins have no row. |
| 2 | **One sentinel van + one sentinel user per vendor.** | Auto-created once (on first walk-in, or seeded). Both carry a system flag (`Van.isSystem`, reuse/extend on `User`) so they are excluded from route generation, fleet/driver dropdowns, reconciliation and login. The sentinel user is the sheet's `driverId` (non-nullable FK anchor). |
| 3 | **`DailySheet.kind` enum: `ROUTE` \| `WALK_IN`, default `ROUTE`.** | This single flag drives every bypass. Existing sheets are all `ROUTE`. |
| 4 | **No crew / odometer / load / trip for `WALK_IN`.** | Sheet is created with `crewConfirmed = true`. `createLoad` / `loadOut` / trip guards are skipped. Items are recorded straight to a terminal status; `dailySheetLoadId` stays `null` ("Unassigned", already supported). |
| 5 | **Each walk-in delivery = one `DailySheetItem`.** | `deliveryType = ON_DEMAND`, `status` set directly to `COMPLETED` (or `EMPTY_ONLY` when `filledDropped = 0`), then `LedgerService.recordDelivery({ ..., dailySheetItemId })`. Mirrors `submitDelivery`'s status auto-flip. |
| 6 | **Channel is a fixed dropdown.** | New nullable column `DailySheetItem.deliveryChannel` — `SELF_PICKUP` \| `THIRD_PARTY` \| `OTHER`. Set only on walk-in items; `null` on route items. Surfaced as a badge/column in transaction and statement views and available as a report filter. |
| 7 | **Back-dating allowed; future dates blocked.** | Date picker accepts any past date. The walk-in sheet for that date is found-or-created. If that date's walk-in sheet is already **closed**, the entry routes through the existing **correction-entry** path so the ledger rows are dated to the sheet's business date (`occurredAt = sheet.date`), not "today". Dates after today are rejected. |
| 8 | **`cashCollected` defaults to `0`.** | Staff types the amount every time (walk-in customers may be on credit). No "assume full payment" prefill. |
| 9 | **Bottle wallet is upserted.** | A walk-in customer with no `BottleWallet` row for the product gets one created (`balance` starting at 0) before the ledger post, so a first-ever purchase does not 400. |
| 10 | **Main sheet list hides `WALK_IN` by default.** | `/dashboard/daily-sheets` shows only `ROUTE` sheets unless a "Walk-in / Self-pickup" filter/tab is selected. |
| 11 | **Access: `VENDOR_ADMIN` + `STAFF`, from a header quick-action.** | New permission key `daily_sheets:record_walk_in` (wildcard covers `vendor_admin`; explicit grant for `staff`). Entry point is a "Record Delivery" item in the header quick-actions menu next to "Record Payment". No customer-detail-page entry in this version. |
| 12 | **Edit / Void reuse existing features.** | Walk-in items expose the same per-row Edit and Void controls as any delivery item — no new mutation code. **Revised 2026-09-11:** no nightly auto-close job exists in this codebase (see the 2026-09-04 Change Log deviation note); a WALK_IN sheet is instead closed manually, through the same `closeSheet`/Soft-Close flow a ROUTE sheet uses (client decision) — see the 2026-09-11 Change Log row. After close, edits go through the closed-delivery path as originally planned. |

---

## 3. Surfaces the `kind = WALK_IN` flag must gate

| Area | Behaviour for `WALK_IN` |
|---|---|
| Auto-generation job (`daily-sheet.service` scheduler / processor) | Never generates a `WALK_IN` sheet. |
| Crew confirmation (`POST /daily-sheets/:id/confirm-crew`, `CREW?` badge) | N/A — created `crewConfirmed = true`. |
| Load-out / trips (`createLoad`, legacy `loadOut`, trip summary) | Skipped. No "Crew confirmation is required" 409. No active-trip requirement to record an item. |
| Odometer / fuel / vehicle daily check prompts | Not shown. |
| Sheet list `/dashboard/daily-sheets` | Hidden unless the Walk-in filter/tab is active. |
| Sheet PDF | Simplified receipt list — no van meta strip, no crew strip, no odometer block, no trip summary. Trip/Bottle&Cash summary sections omitted or reduced. |
| Van-cash reconciliation, crew cash distribution, payroll ledger sync, discrepancy cases | **Revised 2026-09-11** — a `WALK_IN` sheet now closes through the exact same `closeSheet`/`requestClose`→`approveClose` flow as ROUTE (client decision) and gets a real `VanCashHandover` (PENDING → office approval, same as ROUTE) + crew-cash sync (no-op, no crew exists) + Sheet Discrepancy Case creation — EXCEPT the BOTTLE/EMPTY discrepancy types are suppressed for it specifically (`DailySheetService.discrepancyInputFor()`), since `filledOutCount`/`filledInCount`/`emptyInCount` are structurally always 0 for one and would spuriously fire on every close. CASH discrepancy still applies. Excluded from per-van/per-route KPI aggregates (below) as before. |
| Per-van / per-route analytics KPIs | Excluded. |
| Customer consumption & sales analytics, statement, portal | **Included** (it is a real delivery to the customer). |
| Nightly close job | Closes yesterday's `WALK_IN` sheets alongside `ROUTE` sheets. |

---

## 4. Backend surface (to be built)

### 4.1 Schema (additive migration)

- `enum DailySheetKind { ROUTE WALK_IN }`
- `DailySheet.kind DailySheetKind @default(ROUTE)` + index `@@index([vendorId, kind, date])`
- `enum DeliveryChannel { SELF_PICKUP THIRD_PARTY OTHER }`
- `DailySheetItem.deliveryChannel DeliveryChannel?`
- `Van.isSystem Boolean @default(false)` (and a `User` system flag if none is reusable)
- Backfill: all existing sheets `kind = ROUTE` (default handles it); no data change for items.

### 4.2 Service — `DailySheetService` (or a new `WalkInDeliveryService`)

`recordWalkInDelivery(vendorId, dto, user)`:

1. Validate `date <= today`; resolve customer (vendor-scoped) + product.
2. `ensureSentinelVanAndUser(vendorId)` — find-or-create, memoised.
3. `findOrCreateWalkInSheet(vendorId, date)` — `kind = WALK_IN`, sentinel van/driver,
   `crewConfirmed = true`.
4. If that sheet `isClosed` → delegate to the existing correction-entry code path
   (`occurredAt = sheet.date`); else record directly (`occurredAt = now()`).
5. Create `DailySheetItem` — `deliveryType = ON_DEMAND`, `deliveryChannel` from dto,
   `status = filledDropped === 0 ? EMPTY_ONLY : COMPLETED`, `sequence` = next.
6. `bottleWallet.upsert` for `(customerId, productId)`.
7. Resolve `pricePerBottle` — custom price → base price → dto override (mirror `getPrice()`).
8. `LedgerService.recordDelivery({ ...quantities, cashCollected, pricePerBottle,
   dailySheetId, dailySheetItemId, occurredAt })`.
9. Same cache fan-out as `LedgerService.recordPayment()` (customers, overview, analytics,
   customer wallets) plus daily-sheet detail invalidation.
10. Optionally queue the delivery-complete WhatsApp receipt (same as `submitDelivery`).

### 4.3 Controller / DTO

- `POST /daily-sheets/walk-in` (or `/transactions/deliveries`) — `@RequirePermissions('daily_sheets:record_walk_in')`, throttled like `recordPayment` (`short 5/s`, `medium 30/min`).
- `RecordWalkInDeliveryDto`: `customerId`, `productId`, `filledDropped >= 0`, `emptyReceived >= 0`, `filledReceived >= 0`, `cashCollected >= 0` (default 0), `pricePerBottle?` (override), `date` (ISO, `<= today`), `deliveryChannel` (enum), `note?`.
- Validation: at least one of `filledDropped` / `emptyReceived` / `filledReceived` `> 0`.

### 4.4 Permissions

- New key `daily_sheets:record_walk_in`. `vendor_admin` via `*`; `staff` via explicit
  `STAFF_PERMISSIONS` entry + `PRESET_DRIFT_BACKFILLS.staff` catch-up grant for
  already-seeded vendors. Manager/Salesman/Driver do not get it.

### 4.5 Tests

- Sentinel van/user find-or-create idempotency.
- Walk-in sheet find-or-create idempotency for the same `(vendor, date)`.
- Status auto-flip `filledDropped === 0` → `EMPTY_ONLY`.
- Ledger effect: `financialBalance += charge - cash`; wallet `+= dropped - empty - filled`.
- `BottleWallet` upsert when the customer has none for the product.
- Back-dated entry onto an already-closed walk-in sheet → routes through correction path,
  `occurredAt = sheet.date`.
- Future date → 400.
- `kind = WALK_IN` excluded from reconciliation aggregates and the default sheet-list query.
- Permission gate: `staff` allowed, `driver` denied.

---

## 5. Frontend surface (vendor-dashboard, to be built)

- `features/daily-sheets/components/record-walk-in-dialog.tsx` — mirrors the Record Payment
  dialog. Fields: customer combobox (`useCustomerSearch`, server-side debounced), product
  `<select>`, delivered qty, empty received, filled received, price/bottle (prefilled from
  resolved price, editable), cash collected (default empty → 0), date picker (max = today),
  channel dropdown (Self-pickup / Third-party / Other), note textarea.
- `useRecordWalkInDelivery` mutation hook — on success invalidate `queryKeys.customers.all()`,
  overview, analytics, transactions list, customer wallets, daily-sheets list.
- Entry point: "Record Delivery" in the header quick-actions menu
  (`components/layout/header.tsx`), gated on `daily_sheets:record_walk_in`, beside
  "Record Payment".
- `/dashboard/daily-sheets`: add a "Walk-in / Self-pickup" filter chip / tab; default query
  sends `kind=ROUTE`.
- `transaction-list.tsx`: show a "Self-pickup" / "Third-party" badge for rows whose linked
  item has a `deliveryChannel`.

---

## 6. Out of scope (this version)

- Customer-detail-page entry point for Record Delivery.
- A standalone (sheet-less) ledger delivery.
- Bulk / CSV walk-in import.
- Any change to route-sheet generation, trip, or reconciliation logic beyond adding the
  `kind` filter.
- "Assume full cash paid" prefill.

---

## 7. Change Log

| Date | Change |
|---|---|
| 2026-09-04 | Phase 0 document created. Approach (synthetic lazy walk-in sheet), channel dropdown, back-dating allowed, cash default 0, hidden sheet-list tab, header quick-action, `VENDOR_ADMIN + STAFF` — all locked via owner Q&A. |
| 2026-09-11 (superseded same day, see next row) | ~~Van Cash Ledger live-sync~~ — a first attempt kept the WALK_IN sheet permanently open and live-synced its handover on every delivery, auto-APPROVED. Reverted: the client denied auto-approving walk-in cash. |
| 2026-09-11 | **Add/Record menu brought to full parity with ROUTE sheets** (owner decision: Expense + Crew Cash + Fuel Fill + Damage/Incident, not Expense-only). Zero backend changes — `CrewCashDistributionService.create`, `FuelLogService.create` and `DamageCaseService.report` were already sheet-kind-agnostic (Fuel keys off `vehicleId`/`dailySheetId`, both optional/nullable; Crew Cash only requires the target employee be the sheet's driver or in `DailySheetCrew`; Damage has no sheet/van dependency at all). Frontend (`sheet-detail.tsx`) `isWalkIn` block: `SheetCashOutSection` now gets the real `crewCashEmployees` (was `[]`) so its Crew Cash accordion works; `AddRecordMenu` wires `canLogFuel`/`canAddCrewCash`/`canReportDamage` (was `false`) to `OPEN_FUEL_LOG`/`OPEN_CREW_CASH`/`OPEN_DAMAGE`; `FuelLogFormDialog` (already unconditionally rendered off `data?.vanId`, which the sentinel walk-in van always has) needed no change. "Trip Expenses" stat card un-gated from `!isWalkIn`, relabelled "Expenses" for a walk-in sheet. **Known limitation, accepted as-is:** a WALK_IN sheet's `driverId` is the per-vendor sentinel "Walk-in / Self Pickup" user and it has no `DailySheetCrew` rows, so the Crew Cash employee picker only ever offers that one sentinel entry — there is no real crew to distribute cash to until walk-in sheets gain an actual crew-assignment concept. `canAddDelivery` stays `false` (unchanged) — the header's own "Record Delivery" quick-action already covers that. |
| 2026-09-11 | **WALK_IN sheets now close properly, through the SAME flow as ROUTE (client decision, supersedes the row above and §2 point 12/§12's "stays open" deviation).** Also unblocks the Add Expense flow the client asked for on walk-in sheets. Two small, targeted gates — everything else is the existing ROUTE-sheet machinery, unchanged: (1) `assertSheetCloseable()` skips `VehicleCheckService.assertTripEndClear()` for `kind === WALK_IN` (a walk-in sheet has no van/trip, so that end-of-day check is never recorded and would otherwise make it permanently unclosable) — `closeSheet` / `requestClose` → `approveClose` are otherwise untouched, so a walk-in sheet's cash handover is created by the existing `createHandoverForClosedSheet()` PENDING, reviewed via the normal Pending Approvals panel exactly like a route sheet's (the `isWalkIn ? APPROVED : PENDING` special-case in `createHandoverForClosedSheet`/`handlePostCloseCorrection` was removed). (2) `closeSheet`/`approveClose` pass a `DailySheetService.discrepancyInputFor()`-adjusted reconciliation into `SheetDiscrepancyCaseService.createCasesForSheet()` that zeroes the BOTTLE/EMPTY discrepancy magnitudes for a WALK_IN close only — `filledOutCount`/`filledInCount`/`emptyInCount` are structurally always 0 for one (no load-out ever happens), so those two figures aren't a real discrepancy, just "bottles sold today" reflected back with the wrong sign; left unsuppressed, EVERY walk-in close would spawn a spurious case. CASH discrepancy still applies (a genuine counter-cash reconciliation). Expense recording needed **zero backend changes** — `ExpenseService.create()` was already fully generic (`dailySheetLoadId` just resolves to `null` with no active trip); only the frontend "Add Expense" trigger was missing, nested inside the trip-only `LoadTripsSection`. Frontend (`sheet-detail.tsx`): added a `isWalkIn` sibling block rendering `SheetCashOutSection` (Expenses only, `crewMembers={[]}` — a walk-in sheet never has crew) + an `AddRecordMenu` with only `canAddExpense` wired + a "Close Sheet" button dispatching the existing `OPEN_RECONCILE` (the `ReconcileDialog` was already trip-agnostic — zero changes needed to it). The earlier live-sync helper (`syncWalkInSheetCash()`), its two call sites, the `normalizeCashIn()` walk-in title tweak, and `backfill-walk-in-cash-ledger.mjs` were all removed as part of the revert. |
| 2026-09-04 | **Implemented.** Schema: `DailySheetKind` + `DailySheet.kind`, `DeliveryChannel` + `DailySheetItem.deliveryChannel`, `Van.isSystem`, `User.isSystem`, `DailySheet_vendorId_kind_date_idx`; migration `20260904000000_add_walk_in_delivery` (additive). Backend: `DailySheetService.recordWalkInDelivery()` + `ensureWalkInInfra()` + `findOrCreateWalkInSheet()`; `POST /daily-sheets/walk-in` (`daily_sheets:record_walk_in`, throttled); `DailySheetQueryDto.kind` + `findAllPaginated` default-hides `WALK_IN`; processor `vanWhere` excludes `isSystem`; ledger transaction selects expose `deliveryChannel`. RBAC: new `daily_sheets:record_walk_in` in permissions catalog (frozen total 168→169), `MANAGER_PERMISSIONS`, `PRESET_DRIFT_BACKFILLS.manager`, permission-groups label; enforcement-matrix + engine specs updated. Frontend: `RecordWalkInDelivery` self-contained component (picker + form Sheet) wired into `header.tsx` behind `<Can permission="daily_sheets:record_walk_in">`; `useRecordWalkInDelivery` hook + `dailySheetsApi.recordWalkIn` + `SheetQuery.kind`/`RecordWalkInDeliveryData`; sheet-list Route/Walk-in segmented toggle (`?kind=WALK_IN`) + "Walk-in" van cell label; transaction-list channel badge. Tests: `walk-in-delivery.service.spec.ts` (7 cases, green). Same-day entries post at `now()`; back-dated / closed-sheet entries set `isCorrection` + anchor the ledger to the delivery date. Deviation from §2/§12: no nightly auto-close job exists in this codebase, so a WALK_IN sheet stays OPEN until manually closed — date-anchoring is driven by `isBackDated || sheet.isClosed`, not by close state alone. |
