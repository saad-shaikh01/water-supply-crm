# Post-Close Trip Correction

**Status:** Phase 1 (backend + frontend) implemented 2026-09-02. Phase 2 (automated tests
+ manual/regression checklists, §9–§11) complete 2026-09-02. Phase 3 senior review
returned one High (read-modify-write race) — fixed 2026-09-02 with a
`SELECT … FOR UPDATE` row lock at the top of the `correctClosedTrip` transaction (§5, §11).
Branch `repoen-sheet-feature`.
**Owner request:** amend a checked-in load trip's physical counts *after* the daily sheet
has been closed, without reopening the sheet.

Void Delivery (`docs/features/daily-sheet-void-delivery.md`) is the pattern template — this
feature mirrors its permission shape, its dedicated-endpoint approach, its friendly-422
warehouse-error mapping, and its *accepted* PDF/reconciliation divergence.

---

## 1. Problem

`checkinLoad()` (the normal trip check-in / trip-edit path) hard-blocks on
`sheet.isClosed` (`ConflictException('Sheet is already closed')`). Once a sheet is closed
there is no way to fix a mistyped returned-filled / collected-empty / damaged / leaked
count on a trip. The warehouse ledger and the sheet's `filledInCount` / `emptyInCount`
aggregates are then permanently wrong.

## 2. Locked decisions

1. **Dedicated endpoint** `PATCH /daily-sheets/:id/loads/:loadId/correct-checkin` — the
   `checkinLoad` `isClosed` guard is **not** relaxed. That path stays closed-sheet-blocked.
2. **Mandatory free-text note** — `correctionNote`, min 3 non-whitespace chars, max 500.
   Stored **only** in the audit `after` block. No structured enum.
3. Warehouse "Insufficient … stock" on a decrease → caught and rethrown as
   `UnprocessableEntityException` code `CLOSED_TRIP_CORRECTION_INSUFFICIENT_STOCK`. The
   warehouse ledger is **not** bypassed — the operator must adjust stock first.
4. **Accepted divergence** (identical to Void Delivery): the reconciliation preview
   recomputes bottle/empty figures live, so those move — but this feature does **not**
   re-run `buildReconciliation` / `createCasesForSheet` and does **not** touch the frozen
   close-time `cashExpected` (`DailySheet.cashCollected`) or any existing
   `SheetDiscrepancyCase` rows.
5. Frontend Option-3 imbalance chip uses the **backend-matching identity**:
   `trip.loadedFilled + Σ(this trip's items' filledReceived) === soldFilled + trip.returnedFilled`.
   `damagedOnVan` / `leakedOnVan` are shown as a separate informational sub-line
   (`+N damaged, +N leaked on van`), **not** folded into the balance test.
6. Permission `daily_sheets:edit_closed_trip` → Admin + Manager, enforcement-matrix scope
   exactly matches `daily_sheets:void_delivery` (`manager.allow`, `salesman.deny`,
   `driver.deny`).

## 3. Permission — Amendment R12

`daily_sheets:edit_closed_trip` (frozen total 167 → 168; non-page total 98 → 99; no new
`:page`). Added to:

- `libs/shared/authz/src/lib/permissions.ts` — `daily_sheets.actions`, after `void_delivery`.
- `libs/shared/authz/src/lib/presets.ts` — `MANAGER_PERMISSIONS`, after `void_delivery`.
- `libs/shared/database/prisma/rbac-seed.ts` — `PRESET_DRIFT_BACKFILLS.manager` catch-up
  for already-seeded vendors: `['daily_sheets:void_delivery', 'daily_sheets:edit_closed_trip']`.
- `libs/shared/authz/src/lib/permission-groups.ts` — `ACTION_LABELS.edit_closed_trip = 'Edit closed-sheet trip'`.
- Specs bumped: `permissions.spec.ts` `FROZEN_TOTAL` 167 → 168; `engine.spec.ts` manager
  `toContain` / driver `not.toContain`; `enforcement-matrix.spec.ts` `manager.allow` +
  `salesman.deny` + `driver.deny`.
- `docs/rbac-permission-catalog.md` — §11 table row + Amendment R12 paragraph.

**Ops:** after deploy, bust the Redis permission cache (or wait 1h) and run
`npm run rbac:seed` to apply the Manager drift backfill.

## 4. DTO

`apps/api-backend/src/app/modules/daily-sheet/dto/correct-closed-trip.dto.ts` —
`returnedFilled` / `collectedEmpty` / `damagedOnVan` / `leakedOnVan` (`@IsInt @Min(0)`,
copied from `CheckinLoadDto` minus `forceResubmit`) + `correctionNote` (`@IsString`
`@MinLength(3)` `@MaxLength(500)` with a `@Transform` trim so whitespace-only is rejected,
same style as `void-delivery.dto.ts`).

## 5. Service

`apps/api-backend/src/app/modules/daily-sheet/daily-sheet.service.ts`:

### `applyTripCheckinDeltas(tx, load, dto, opts)` — pure extraction

The trip-check-in **edit** delta logic was lifted verbatim out of `checkinLoad()`'s edit
branch into a private helper. It computes the signed delta of each of the four counts vs
`load`, writes the new absolute values (`+ editCount:{increment:1}` `+ lastEditedAt`),
adjusts `DailySheet.filledInCount` / `emptyInCount` by the delta, and posts the signed
`warehouse.recordCheckinCorrection`. Returns `{ load: <updated row>, deltas }`.

`checkinLoad()`'s edit branch now calls this helper; its first-time-check-in branch is
unchanged (still the four separate `recordCheckin{Filled,Empty,Damaged,Leaked}` calls +
`endedAt: new Date()`). The old edit branch wrote `endedAt: load.endedAt` (a no-op
self-write); the helper omits `endedAt` entirely → same result. Verified by
`daily-sheet-close-crew-cash-sync.spec.ts` + `daily-sheet-close-discrepancy-cases.spec.ts`
+ every other daily-sheet spec still green (only the 2 pre-existing broken suites fail).

### `correctClosedTrip(user, sheetId, loadId, dto)`

- `dailySheet.findFirst({ id, vendorId })` → `NotFoundException`.
- `!sheet.isClosed` → `ConflictException('This sheet is not closed. Use the normal trip check-in edit.')`.
- `dailySheetLoad.findFirst({ id: loadId, dailySheetId })` → `NotFoundException`;
  `!load.endedAt` → `ConflictException('Trip has not ended')` (defensive).
- `maxReturnedFilled` cap replicated from `checkinLoad`:
  `load.loadedFilled + Σ(filledReceived where deliveredAt >= load.startedAt)` →
  `BadRequestException` if exceeded.
- `$transaction`: **first statement is a row lock** —
  ``tx.$queryRaw`SELECT 1 FROM "DailySheetLoad" WHERE id = ${loadId} FOR UPDATE` `` —
  which serialises concurrent corrections of the same trip so the in-txn re-read below
  always sees the prior corrector's *committed* counts. Under READ COMMITTED (the Prisma
  default — no `isolationLevel` is set) two racing corrections would otherwise both read
  the same base, both compute signed deltas off it, and both apply → sheet aggregates +
  warehouse stock/ledger drift, with the absolute `dailySheetLoad.update` last-writer-wins.
  `DailySheetLoad.id` is a `text` column — the tagged template binds `${loadId}` as a
  parameter, no `::uuid` cast. Then re-reads the load (`findUnique`, selected fields) and
  computes deltas from *that* now-lock-guaranteed-latest snapshot — unlike `checkinLoad`,
  which trusts its pre-txn read. Calls `applyTripCheckinDeltas`; a warehouse
  `/insufficient/i` `BadRequestException` → `UnprocessableEntityException({ code:
  'CLOSED_TRIP_CORRECTION_INSUFFICIENT_STOCK' })`.
- After commit: `audit.log({ action: 'CLOSED_TRIP_CHECKIN_CORRECTED', entity:
  'DailySheetLoad', entityId: loadId, changes: { before: <pre-txn load's 4 counts>,
  after: { ...dto 4 counts, correctionNote } } })`.
- 3-way cache invalidation (`invalidateDailyDashboard` + `invalidateOverview` +
  `invalidateAnalytics`), matching `voidDelivery` — not `checkinLoad`'s single
  `invalidateDailyDashboard`.
- **No** `buildReconciliation` / `createCasesForSheet` / `cashExpected` write (see §2.4).

## 6. Controller

`@Patch(':id/loads/:loadId/correct-checkin')`,
`@RequirePermissions('daily_sheets:edit_closed_trip')`,
`@Throttle({ short: {ttl:1000,limit:5}, medium: {ttl:60000,limit:20} })`. Placed next to
the other `:id/loads/:loadId/*` routes.

## 7. Frontend

- `api/daily-sheets.api.ts` — `correctClosedTrip(sheetId, loadId, body)` →
  `PATCH …/correct-checkin`.
- `hooks/use-daily-sheets.ts` — `useCorrectClosedTrip(sheetId)`, **`retry: 0`**
  (non-idempotent signed delta). `onSuccess`: invalidate `sheets.one(sheetId)` + `['sheets']`
  + toast "Trip check-in corrected". `onError`: specific toast for
  `CLOSED_TRIP_CORRECTION_INSUFFICIENT_STOCK`, else generic.
- `components/dialogs/checkin-dialog.tsx` — new optional `isClosed` prop. When
  `isClosed && mode === 'edit'`: title "Correct Closed-Sheet Trip Check-In", an amber
  "sheet is closed …" banner, a **required** "Reason for correction" textarea (≥3 chars
  after trim, submit disabled until valid), and submit routes to `useCorrectClosedTrip`
  instead of `useCheckinLoad`. Non-closed behavior unchanged.
- `components/load-trips-section.tsx` — new `canEditClosedTrip` prop. On a closed sheet an
  **ended** trip now shows a plain **Edit** button (no request/unlock sub-tree). LOADED /
  RETURNED / EMPTIES labels get a `· at check-in` suffix when `isClosed` (per-trip card +
  totals row). Per-trip amber **imbalance chip** when `trip.endedAt` and
  `loadedFilled + Σ filledReceived ≠ soldFilled + returnedFilled`, plus a muted
  `+N damaged, +N leaked on van` sub-line when `trip.endedAt` and either is > 0.
- `components/sheet-detail.tsx` — `canEditClosedTrip = can('daily_sheets:edit_closed_trip')`,
  threaded into `<LoadTripsSection>`; the edit `<CheckinDialog mode="edit">` instance now
  gets `isClosed={isClosed}`.

## 8. Not done here

- **Phase 3 — senior review.**
- No schema migration (no new columns — `editCount` / `lastEditedAt` already exist on
  `DailySheetLoad`).

---

## 9. Test inventory (Phase 2)

All three specs are mock-Prisma unit style (no live DB), mirroring
`void-delivery.service.spec.ts` / `void-guards.spec.ts` / `dto/void-delivery.dto.spec.ts`.
Run: `npx nx test api-backend --testPathPatterns="modules/daily-sheet"` — **14 suites pass,
122 tests pass**; the only failures are the 2 pre-existing broken suites
(`daily-sheet-notifications` TS2345 `string` vs `AuthUser`; `daily-sheet-generation` Nest DI
`VehicleCheckService`), untouched by this feature.

### `apps/api-backend/src/app/modules/daily-sheet/dto/correct-closed-trip.dto.spec.ts` — 10 tests

`CorrectClosedTripDto` class-validator checks (`validate` + `plainToInstance`):

- 4 non-negative ints + `correctionNote` "fixed count" → 0 errors; all-zero counts also valid.
- `correctionNote` missing → error on `correctionNote`.
- `correctionNote` "ab" (len 2) → error (below `@MinLength(3)`).
- `correctionNote` "   " (whitespace, `@Transform` trims to "") → error.
- `correctionNote` > 500 chars → error (`@MaxLength(500)`).
- `correctionNote` "abc" (exactly 3) → valid.
- `returnedFilled: -1` → error (`@Min(0)`); `collectedEmpty: 1.5` → error (`@IsInt`).
- a missing count field (`damagedOnVan` absent) → error.

### `apps/api-backend/src/app/modules/daily-sheet/post-close-trip-correction.service.spec.ts` — 13 tests

`DailySheetService.correctClosedTrip(user, sheetId, loadId, dto)`:

- **happy path** — single `$transaction`; the **row lock** (`tx.$queryRaw` with a
  `FOR UPDATE` fragment and `loadId` bound as a parameter) fires exactly once and **before**
  the `dailySheetLoad.findUnique` re-read; the in-tx re-read happens;
  `dailySheetLoad.update` = 4 absolute values + `editCount:{increment:1}` + `lastEditedAt`
  (Date); `dailySheet.update` moves `filledInCount` / `emptyInCount` by the **delta computed
  from the in-tx re-read** (10→20 = +10, 5→8 = +3); `warehouse.recordCheckinCorrection`
  called `(vendorId, productId, {filledDelta:10, emptyDelta:3, damagedDelta:1,
  leakedDelta:2}, sheetId, tx)`; `audit.log` `action:'CLOSED_TRIP_CHECKIN_CORRECTED'`,
  `entity:'DailySheetLoad'`, `before` = pre-tx 4 counts, `after` = dto 4 counts +
  `correctionNote`; all 3 cache invalidations fire (`invalidateDailyDashboard(vendor,
  '2026-08-22')`, `invalidateOverview`, `invalidateAnalytics`).
- **`productId === null`** on the load → `warehouse.recordCheckinCorrection` NOT called;
  load update, sheet update, audit and cache all still run.
- **in-tx re-read drives the delta** — outer read `returnedFilled:10`, in-tx re-read
  `returnedFilled:12` (concurrent correction landed in between), dto `20` → `filledInCount`
  delta is `+8` (20−12), and `warehouse` `filledDelta:8`; audit `before.returnedFilled`
  still `10` (the pre-tx snapshot the operator saw).
- **no reconciliation side effects** — `buildReconciliation` (spied) NOT called;
  `discrepancyCases.createCasesForSheet` NOT called; no outer `dailySheet.update`; the
  in-tx `dailySheet.update` payload has no `cashExpected` / `cashCollected` key.
- `!sheet.isClosed` → `ConflictException`; `$transaction` / `audit` / cache untouched.
- sheet not found → `NotFoundException`; `$transaction` not called.
- wrong tenant (vendor-scoped `findFirst` returns null) → `NotFoundException`.
- load not found → `NotFoundException`.
- `!load.endedAt` → `ConflictException`; `$transaction` not called.
- `dto.returnedFilled` > `load.loadedFilled + Σ filledReceived` (aggregate `_sum` mocked)
  → `BadRequestException`; exactly at the cap → resolves.
- warehouse `BadRequestException('Insufficient filled stock …')` → surfaces as
  `UnprocessableEntityException` with `response.code:
  'CLOSED_TRIP_CORRECTION_INSUFFICIENT_STOCK'`; audit + cache never run.
- warehouse `BadRequestException` **without** "insufficient" → rethrown unchanged
  (`BadRequestException`, not `UnprocessableEntityException`).

### `apps/api-backend/src/app/modules/daily-sheet/post-close-trip-guards.spec.ts` — 4 tests

Boundary between `checkinLoad` and the new endpoint + `applyTripCheckinDeltas` extraction
parity:

- `checkinLoad()` still throws `ConflictException` on a **closed** sheet — the extraction +
  new endpoint did **not** relax that guard; `$transaction` never runs.
- `checkinLoad()` **edit branch** (`forceResubmit` + ended trip, `VENDOR_ADMIN`): load
  update = 4 absolute values + `editCount:{increment:1}` + `lastEditedAt`, **no `endedAt`
  key**; `dailySheet.update` by the delta (10→20 = +10, 5→8 = +3);
  `warehouse.recordCheckinCorrection` by the delta; the 4 first-time `recordCheckin*`
  helpers **not** called.
- `checkinLoad()` **first-time check-in** (no `forceResubmit`, `endedAt` null): load update
  stamps `endedAt` (Date), **no `editCount` key**; `dailySheet.update` by the full new
  values (+20 / +8); the 4 separate `recordCheckin{Filled,Empty,Damaged,Leaked}` called
  with the absolute counts; `recordCheckinCorrection` **not** called.

### authz — unchanged, re-verified

`npx nx test authz` → **3 suites, 235 tests, all green**; `permissions.spec.ts`
`FROZEN_TOTAL` assertion holds at **168** (Phase 1's `daily_sheets:edit_closed_trip`). No
edits made in Phase 2.

### Frontend

`apps/vendor-dashboard/project.json` has **no `test` target** (only `build` / `serve` /
`lint`) — there is no FE unit harness. The dialog / Edit-button / chip / label behavior is
covered by the **Manual test checklist** below.

---

## 10. Manual test checklist

Setup: a **closed** daily sheet with at least one ended load trip that has a `productId`,
and enough warehouse stock to absorb a decrease. "Trip card" = the per-trip block in
`load-trips-section.tsx` on the sheet detail page.

- [ ] **Admin corrects RETURNED / EMPTIES on a closed sheet.** Log in as `VENDOR_ADMIN`,
      open the closed sheet → the ended trip shows a plain **Edit** button (no
      request/unlock sub-tree). Click it → dialog title "Correct Closed-Sheet Trip
      Check-In", amber "sheet is closed…" banner, a required "Reason for correction"
      textarea. Change RETURNED and EMPTIES, enter a 5-char reason, Save → toast "Trip
      check-in corrected". Expected: no error, dialog closes.
- [ ] **Manager can do the same.** Repeat as a `MANAGER` user. Expected: identical success
      (permission `daily_sheets:edit_closed_trip` is Admin + Manager).
- [ ] **Staff / Salesman / Driver cannot.** As each of `STAFF`, `SALESMAN`, `DRIVER`: on a
      closed sheet the **Edit** button is **absent** on ended trips. Hitting
      `PATCH /daily-sheets/:id/loads/:loadId/correct-checkin` directly → **403**.
- [ ] **Reason note is mandatory.** In the dialog: empty reason → Save disabled, hint
      "Enter at least 3 characters."; 2 chars → still disabled; "   " (3 spaces) → rejected
      (server trims to empty → 400 if it somehow reaches the API). 3+ non-space chars →
      Save enabled.
- [ ] **Live UI update after a correction.** After Save, without reloading: the trip card's
      RETURNED / EMPTIES values update, the `· at check-in` label suffixes are present on
      LOADED / RETURNED / EMPTIES (per-trip + Σ totals row), and the amber **imbalance
      chip** appears/updates/clears per the identity
      `loadedFilled + Σ filledReceived === soldFilled + returnedFilled`. If `damagedOnVan`
      or `leakedOnVan` > 0, the muted `+N damaged, +N leaked on van` sub-line reflects the
      new numbers.
- [ ] **Reconciliation preview moves, frozen figures do not.** Open the sheet's
      reconciliation / close view: the bottle & empty figures recompute live and reflect
      the correction, **but** the close-time cash figure (`DailySheet.cashCollected` /
      `cashExpected`) is unchanged and **no new `SheetDiscrepancyCase` rows** are created
      (and existing ones are untouched).
- [ ] **PDF re-export — accepted divergence (call this out).** Re-export the sheet PDF: the
      **trip numbers** show the corrected RETURNED / EMPTIES and the **verdict / balance
      banner may flip** (balanced ↔ imbalanced) because it is recomputed from live trip
      data — while the **Discrepancy Details table is unchanged** (it is built from the
      frozen close-time cases). This mismatch between a flipped banner and a stale
      discrepancy table is **expected and accepted** for trip corrections, exactly as for
      Void Delivery.
- [ ] **Decrease below warehouse stock → 422.** Set warehouse filled stock low, then
      correct RETURNED far **down** (large negative delta) → **422** with code
      `CLOSED_TRIP_CORRECTION_INSUFFICIENT_STOCK` and the toast "Warehouse stock would go
      negative…". The correction is **not** applied (transaction rolled back); fix stock
      first, retry → succeeds.
- [ ] **Over-cap increase → 400.** Correct RETURNED **above**
      `loadedFilled + Σ(filledReceived on items delivered since trip start)` → **400**
      "Cannot return more filled bottles…". Nothing mutated.
- [ ] **Aug-17 → Aug-22 void follow-up (end-to-end).** On a closed sheet: void a COMPLETED
      delivery on one of the trips (Void Delivery feature), then use Post-Close Trip
      Correction to bring that trip's RETURNED **down** to match the now-lower sold count.
      Expected: both operations succeed independently; warehouse ledger + sheet
      `filledInCount` / `emptyInCount` reflect both; two separate audit rows
      (`DELIVERY_VOIDED`, then `CLOSED_TRIP_CHECKIN_CORRECTED`); the imbalance chip on that
      trip clears.
- [ ] **`checkinLoad` still blocked on a closed sheet.** The normal trip check-in / trip
      edit-unlock path (`POST /daily-sheets/:id/loads/:loadId/checkin`, and the driver
      request-edit → staff-unlock flow) still returns **409 "Sheet is already closed"** on
      a closed sheet. The dedicated endpoint is the only way in.
- [ ] **Open-sheet trip edit unchanged.** On an **open** sheet, the existing trip
      edit-unlock flow (driver requests, staff unlocks, driver re-submits with
      `forceResubmit`) still works byte-for-byte: `editCount` increments, `lastEditedAt`
      stamps, sheet aggregates + warehouse ledger move by the delta, `endedAt` unchanged,
      a `TRIP_EDIT_OVERRIDE` audit row is written. No "closed sheet" banner, no mandatory
      reason note.
- [ ] **Audit trail.** Every correction writes exactly one `CLOSED_TRIP_CHECKIN_CORRECTED`
      `AuditLog` row (`entity: DailySheetLoad`, `entityId` = loadId) whose `changes.after`
      contains the `correctionNote` — the note is stored **nowhere else**.

---

## 11. Regression checklist (Phase 0 hotlist)

- [ ] **Permission-count tripwire.** `permissions.spec.ts` `FROZEN_TOTAL` = **168**;
      `npx nx test authz` green (235 tests). No new `:page` permission. `FROZEN_PAGES` /
      `FROZEN_RESOURCES` untouched.
- [ ] **`checkinLoad` extraction parity.** `applyTripCheckinDeltas` is the single source of
      truth for the edit-branch delta math; `checkinLoad`'s edit branch and
      `correctClosedTrip` both call it. Covered by `post-close-trip-guards.spec.ts`
      (edit-branch + first-time branch) and the close specs
      (`daily-sheet-close-crew-cash-sync`, `daily-sheet-close-discrepancy-cases`) still
      green. The dropped `endedAt: load.endedAt` self-write is a Prisma no-op — the helper
      omits `endedAt` and the parity test asserts the key is absent.
- [ ] **Non-idempotent signed delta + retry.** The correction applies a *delta*, so a
      double-submit double-applies. Frontend hook uses **`retry: 0`**; the endpoint is
      `@Throttle`d (5/s, 20/min). Manual: rapid double-click Save → only one
      `CLOSED_TRIP_CHECKIN_CORRECTED` audit row.
- [x] **Read-modify-write race — mitigated by a row lock.** The `$transaction` opens with
      ``tx.$queryRaw`SELECT 1 FROM "DailySheetLoad" WHERE id = ${loadId} FOR UPDATE` `` as
      its first statement, so concurrent corrections of the same load serialise: the second
      corrector blocks until the first commits, then its in-tx `findUnique` re-read sees the
      first's committed counts and its delta nets against them. Without the lock, under
      READ COMMITTED both could read the same base and both apply (sheet aggregates +
      warehouse stock/ledger drift; absolute `dailySheetLoad.update` last-writer-wins).
      Covered by the happy-path service test (asserts `$queryRaw` fires once, before the
      re-read, with a `FOR UPDATE` fragment and `loadId` bound) + the "in-tx re-read drives
      the delta" test. Phase 3 review's `updateMany`-claim alternative was considered and
      **not** adopted — the row lock is the minimal fix and keeps the write path inside the
      shared `applyTripCheckinDeltas` helper unchanged. `checkinLoad`'s open-sheet edit path
      is intentionally left as-is (different risk profile; not in scope).
- [ ] **PDF verdict divergence.** Accepted and documented (§2.4, §10). The PDF verdict
      banner is recomputed live and may flip; the Discrepancy Details table stays frozen.
      No code change — verify the manual PDF step reads as "expected".
- [ ] **Warehouse insufficient-stock.** A decrease that would drive warehouse stock
      negative → `422 CLOSED_TRIP_CORRECTION_INSUFFICIENT_STOCK`, transaction rolled back,
      ledger **not** bypassed. Covered by the service test; manual step confirms the toast
      + rollback.
- [ ] **Cache-invalidation breadth.** `correctClosedTrip` fans out the **3-way**
      invalidation (`invalidateDailyDashboard` + `invalidateOverview` +
      `invalidateAnalytics`), matching `voidDelivery` — not `checkinLoad`'s single
      `invalidateDailyDashboard`. Covered by the happy-path service test.
- [ ] **Half-done frontend gates.** `canEditClosedTrip = can('daily_sheets:edit_closed_trip')`
      gates the Edit button; the dialog's required-reason gate disables Save until ≥3
      trimmed chars; the mutation hook maps the 422 code to a specific toast. Manual:
      Staff/Salesman/Driver see no Edit button **and** the API 403s them.
- [ ] **RBAC drift backfill.** `PRESET_DRIFT_BACKFILLS.manager` includes
      `daily_sheets:edit_closed_trip`. **Ops on deploy:** run `npm run rbac:seed` and bust
      the Redis permission cache (or wait 1h) so already-seeded Manager roles pick up the
      new permission.
