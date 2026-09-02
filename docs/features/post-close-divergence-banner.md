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

## Hybrid cash rollups

The post-close divergence banner tells a reviewer that one sheet's frozen cash
snapshot is stale. The **month-level and list aggregations** that SUM
`DailySheet.cashExpected` / `DailySheet.cashCollected` across many sheets had the
same staleness with no signal: after a post-close void the bottle columns (live
item query) drop while the summed cash columns stay frozen, so the row is
internally inconsistent.

Fix — **hybrid**, per sheet:

- **Untouched after close (or still open)** → use the frozen close-time columns
  unchanged. Historical months with no post-close edits stay **byte-identical**.
- **Modified after close** → recompute cash live from current data:
  `cashCollected = buildReconciliation(sheet).driver.shouldHandIn`
  (Σ `item.cashCollected` over non-`VOIDED` items),
  `cashExpected = buildReconciliation(sheet).driver.netToHandIn`.

**"Modified after close" predicate** (`isSheetModifiedAfterClose`, the exact one
the banner uses):
`items.some(voidedAt != null)` OR
`items.some(isCorrection && correctionAddedAt != null)` OR
`loads.some((editCount ?? 0) > 0)`.
The same `editCount > 0` pre-close-in-window over-flag applies — accepted, the
recompute is still correct, just occasionally unnecessary.

**Detect-then-resolve flow** (keeps the common path cheap): each caller runs a
light `dailySheetItem` + `dailySheetLoad` query over its date range to collect
the ids of closed sheets that match the predicate, targeted-reloads **only those**
with `SHEET_CASH_RELOAD_INCLUDE`, and calls `resolveSheetCash(sheet)`. Every
other sheet keeps its already-selected frozen columns. `resolveSheetCash` never
throws — on any `buildReconciliation` error it falls back to the frozen columns
with `postCloseModified: true` and a `logger.warn`.

Shared helper: `apps/api-backend/src/app/modules/daily-sheet/sheet-cash.util.ts`
(`resolveSheetCash`, `isSheetModifiedAfterClose`, `buildReconciliation` — moved
here from `DailySheetService` as a pure function; the service keeps a thin
delegating method).

**Surfaces recomputed:**

| Surface | Field(s) | Marker |
| --- | --- | --- |
| `dashboard.getMonthlySummary` | `cashExpected`, `cashCollected`, `collectionRate` per month; new `hasModifiedClosedSheets` per row | widget: `*` on the month + footnote |
| `analytics.getFinancial` | `revenueByRoute[].revenue`, `cashByVan[].cashExpected/cashCollected`, `collectionRate` | — |
| `daily-sheet.getDriverStats` | `cashExpected`/`cashCollected` totals + per-sheet; new `postCloseModified` per sheet. Also: `itemStats`/`failureStats` groupBy now exclude `VOIDED` so `totalItems`/`successRate` stop counting voided stops | — |
| `daily-sheet.findAllPaginated` | list row `cashCollected` overridden with the light non-voided item re-sum (no `buildReconciliation` per row); new `postCloseModified` per row | sheet list: amber dot beside Cash |

Left untouched: `analytics.getFinancial.cashByPaymentType` and the
Transaction-based `revenue*` series (already live / `VOIDED`-filtered).

**Cache:** `CacheInvalidationService.invalidateAnalytics` (fired by every
post-close mutation) now also clears `dashboard:monthly-summary:*`,
`dashboard:revenue:*`, `dashboard:top-customers:*`,
`dashboard:route-performance:*`, `dashboard:staff-performance:*` — previously only
`dashboard:analytics:*` was cleared, leaving these derived rollups stale until TTL.
