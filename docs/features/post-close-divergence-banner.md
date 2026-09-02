# Post-Close Divergence Banner (Option C)

**Status: IMPLEMENTED (2026-09-02). Backend + frontend + unit test. No schema
migration, no new permission.** Branch `repoen-sheet-feature`.

## Problem

On a **closed** daily sheet, `DailySheet.cashExpected` / `cashCollected` and the
`SheetDiscrepancyCase` rows are frozen snapshots taken at close time. The three
sibling retroactive tools — **Void Delivery**, **Edit Closed-Sheet Delivery**,
**Post-Close Trip Correction** (plus **Add Missed Delivery**) — all deliberately
leave that snapshot untouched (their "accepted divergence" sections). After any
of them the live customer ledger and the on-sheet reconciliation summary
legitimately disagree, which looks like stale/buggy data. Option C makes the
divergence legible with an informational banner.

## What it detects

`DailySheetService.findOne(vendorId, id)` — after assembling the sheet response,
**when `sheet.isClosed && sheet.cashExpected != null`** — re-runs the pure,
in-memory `buildReconciliation(sheet)` on the data `findOne` already loaded (no
extra DB query) and compares:

- `cashExpectedNow = liveRecon.driver.netToHandIn` (the exact field persisted as
  `cashExpected` at close, in `closeSheet` / `requestClose` / `approveClose`)
- `cashExpectedAtClose = sheet.cashExpected`
- `cashDelta = round2(cashExpectedNow - cashExpectedAtClose)`

Plus three change tallies over the loaded items/loads:

- `voidedCount` — items with `voidedAt != null`
- `correctionCount` — items with `isCorrection && correctionAddedAt != null`
  (covers Edit Closed-Sheet Delivery and Add Missed Delivery)
- `tripCorrectCount` — loads with `editCount > 0`. **Known minor over-flag:** a
  pre-close in-window trip edit made before the sheet was ever closed also has
  `editCount > 0` and will be counted — acceptable, the banner is informational.

`diverged = Math.abs(cashDelta) >= 1 || reasons.length > 0`. The response carries
`postCloseDivergence: { diverged: true, cashExpectedAtClose, cashExpectedNow,
cashDelta, reasons }` when diverged, else `{ diverged: false }` (or nothing on an
open / legacy pre-feature sheet). The whole block is wrapped in try/catch — any
failure logs a `logger.warn` and degrades to `{ diverged: false }`; `findOne`
never breaks.

## Where it shows

`apps/vendor-dashboard/src/features/daily-sheets/components/sheet-detail.tsx` —
an amber informational banner (`History` icon) next to the other lifecycle
banners, rendered only when `data.postCloseDivergence?.diverged`. Heading
"Modified after close"; body explains the figures below are close-time values; a
cash line when `cashDelta` is non-zero; a "Changes: …" line from `reasons`; an
optional "View discrepancy cases" link when the sheet has open cases.

Type: `SheetDetail.postCloseDivergence?` in
`libs/shared/types/src/lib/api-responses.ts`.

## It is informational only

No figure is changed. The cash tiles, the reconciliation card, `cashExpected`,
`cashCollected` and every existing `SheetDiscrepancyCase` row are left exactly as
frozen at close. This banner only surfaces that a post-close change happened and
by how much the recalculated expected cash now differs.

## Test

`apps/api-backend/src/app/modules/daily-sheet/post-close-divergence.spec.ts` —
mock-Prisma unit style: (1) closed sheet + `cashExpected 5000` + a voided stop,
live `netToHandIn` 4500 → `diverged`, `cashDelta -500`, `reasons` has a "voided"
entry; (2) closed sheet, no changes, live recon === `cashExpected` →
`{ diverged: false }`; (3) open sheet → no `postCloseDivergence`; (4)
`buildReconciliation` throws → `findOne` still returns, `{ diverged: false }`.
