# Post-Close Expense Correction

**Status:** implemented 2026-09-07 (backend + frontend + unit tests). Branch
`repoen-sheet-feature` / `feature/expense-center`.
**Owner request:** edit, delete, or add an **Expense** row on a daily sheet *after* the
sheet has been closed, without reopening it.

**Void Delivery** (`docs/features/daily-sheet-void-delivery.md`) and **Post-Close Trip
Correction** (`docs/features/post-close-trip-correction.md`) are the pattern templates —
this feature mirrors their permission shape, their dedicated-endpoint approach, their
`SELECT … FOR UPDATE` concurrency guard, and their *accepted* reconciliation divergence.

---

## 1. Problem

`ExpenseService.create()` hard-blocked `dto.dailySheetId` on `sheet.isClosed`, but
`ExpenseService.update()` / `remove()` had **no such guard** — a closed-sheet expense
could still be silently edited or hard-deleted, changing the sheet's cash-out total with
no audit trail and no divergence signal. Conversely there was no supported way to fix a
genuinely wrong closed-sheet expense (mistyped amount, wrong category, duplicate).

## 2. Locked decisions

1. **Scope: all three** — edit + delete + add.
2. **Permission** `daily_sheets:edit_closed_expense` → **Admin + Manager** (Amendment R13),
   enforcement-matrix scope identical to `void_delivery` / `edit_closed_trip`
   (`manager.allow`, `salesman.deny`, `driver.deny`).
3. **Marker** — one new column `DailySheet.postCloseExpenseCorrectionCount Int @default(0)`,
   incremented by every one of the three endpoints. One migration
   (`20260907010000_add_post_close_expense_correction`).
4. **Delete = hard delete** (`tx.expense.delete`). The audit `before` block is the only
   surviving record — no soft-delete column.
5. **Hosted on `ExpenseController`** (`/expenses`), not the daily-sheet controller.
6. Correcting an expense linked to a `FuelLog` / `VehicleServiceRecord` / `SheetDiscrepancyCase`
   → `ConflictException` ("linked to a Fuel Log / service / discrepancy record — cannot be
   corrected here"). Those rows are managed from their own source records.
7. **Mandatory `correctionNote`** (`@IsString @MinLength(3) @MaxLength(500)`, `@Transform`
   trim) on all three. Stored **only** in the audit `after` / `before` block — no
   `Expense.correctionNote` column.
8. `SELECT … FOR UPDATE` row lock on the `Expense` row is the first statement in each
   `$transaction`, followed by an in-txn re-read + re-assert the sheet is still closed
   (mirrors `correctClosedTrip`).
9. **Accepted divergence** — these endpoints do **not** re-run `buildReconciliation` /
   `createCasesForSheet` and do **not** rewrite the frozen close-time
   `DailySheet.cashExpected` / `cashCollected`. The post-close divergence banner and the
   hybrid cash rollups surface it (§5).
10. The ordinary `PATCH /expenses/:id` and `DELETE /expenses/:id` now **reject** a
    closed-sheet expense (`ConflictException`, pointing at the `/correct` and `/void`
    endpoints) — closing the latent hole. `FuelLogService` has the same latent hole for
    fuel-linked expenses on closed sheets; **left as-is**, flagged for a follow-up.

## 3. Permission — Amendment R13

`daily_sheets:edit_closed_expense` (frozen total 169 → 170; no new `:page`). Added to
`permissions.ts` (`daily_sheets.actions`, after `record_walk_in`), `permission-groups.ts`
(`edit_closed_expense: 'Edit closed-sheet expense'`), `presets.ts` (`MANAGER_PERMISSIONS`),
`rbac-seed.ts` (`PRESET_DRIFT_BACKFILLS.manager` catch-up for already-seeded vendors),
`permissions.spec.ts` (`FROZEN_TOTAL` 169 → 170), `engine.spec.ts` + `enforcement-matrix.spec.ts`
(manager allow / salesman + driver deny), and `docs/rbac-permission-catalog.md`.

## 4. API

| Method / path | Service | DTO |
|---|---|---|
| `PATCH /expenses/:id/correct` | `ExpenseService.correctClosed` | `CorrectClosedExpenseDto` (all fields optional + required `correctionNote`) |
| `POST /expenses/:id/void` | `ExpenseService.voidClosed` | `VoidClosedExpenseDto` (only `correctionNote`) |
| `POST /expenses/closed` | `ExpenseService.createClosed` | `AddClosedExpenseDto` (`CreateExpenseDto` + required `dailySheetId` + `correctionNote`) |

All three: `@RequirePermissions('daily_sheets:edit_closed_expense')` +
`@Throttle({ short: {ttl:1000,limit:5}, medium: {ttl:60000,limit:20} })`. Static-suffix
routes declared before the `:id`-only param routes in the controller.

Each method: load + shared guards (404 / not-on-a-closed-sheet 409 / linked-record 409),
then `$transaction` → `SELECT 1 FROM "Expense" WHERE id = $1 FOR UPDATE` → in-txn re-read
+ re-assert closed → mutate (`update` / `delete` / `create`) →
`dailySheet.update({ data: { postCloseExpenseCorrectionCount: { increment: 1 } } })`.
Post-commit: `audit.log({ action: 'CLOSED_EXPENSE_CORRECTED' | '…_VOIDED' | '…_ADDED', … })`
carrying the `correctionNote`, then the 3-way cache fan-out
(`invalidateDailyDashboard(vendorId, sheetDate)` + `invalidateOverview` + `invalidateAnalytics`).
`createClosed` infers `dailySheetLoadId` from the sheet's **last-ended** trip (a closed
sheet has no active trip), or null.

## 5. Divergence + rollup integration

- `sheet-cash.util.ts` `isSheetModifiedAfterClose` — param type widened; returns true when
  `(sheet.postCloseExpenseCorrectionCount ?? 0) > 0`. `SHEET_CASH_RELOAD_INCLUDE` already
  uses `include` (all scalars) + selects `expenses`, so `resolveSheetCash` recomputes
  correctly with no shape change.
- `daily-sheet.service.ts` `findAllPaginated` — passes `postCloseExpenseCorrectionCount`
  into the `isSheetModifiedAfterClose({…})` call.
- `daily-sheet.service.ts` `findOne` `postCloseDivergence` block — pushes
  `"${n} expense correction(s)"` into `reasons` from `sheet.postCloseExpenseCorrectionCount`.
- `dashboard.service.ts` `getMonthlySummary`, `analytics.service.ts` `getFinancial`,
  `daily-sheet.service.ts` `getDriverStats` — each gains a 3rd detect probe
  (`dailySheet.findMany({ where: { …, isClosed: true, postCloseExpenseCorrectionCount: { gt: 0 } }, select: { id: true } })`)
  whose ids are spread into `modifiedSheetIds`; the existing targeted-reload +
  `resolveSheetCash` path then recomputes those sheets live.

## 6. Frontend

`expenses.api.ts` (`correctClosed` / `voidClosed` / `createClosed`), `use-expenses.ts`
(`useCorrectClosedExpense` / `useVoidClosedExpense` / `useAddClosedSheetExpense` — all
`retry: 0`, invalidate `['expenses']` + `['sheets', sheetId]` + `['sheets']` +
`['expense-center']` + `['analytics']` + `['dashboard']`). New dialogs
`daily-sheets/components/dialogs/edit-closed-expense-dialog.tsx` (edit **and** add — amber
banner + mandatory reason textarea, submit gated on `note.trim().length >= 3`) and
`void-closed-expense-dialog.tsx`. `SheetExpensesSection` gains a `canCorrectClosedExpense`
prop; the Pencil / Trash actions and the AddRecordMenu "Expense" item branch on `isClosed`
to the new dialogs/hooks. `sheet-detail.tsx` resolves
`can('daily_sheets:edit_closed_expense')` and threads it through `SheetCashOutSection`.

## 7. Tests

- `apps/api-backend/src/app/modules/expense/expense-closed-correction.service.spec.ts` —
  `correctClosed` 409 (open) / 404 / 409 (fuel-linked) / happy path (fields, counter,
  audit note, no cashExpected write, 3-way cache); `voidClosed` hard-delete + counter +
  audit before / 409 (discrepancy-linked); `createClosed` 409 (open) + happy path;
  `update()` / `remove()` closed-sheet 409.
- `dto/correct-closed-expense.dto.spec.ts` — `correctionNote` blank / whitespace / <3 /
  >500 / missing → invalid; valid cases; `amount` < 0.01 → invalid.
- `sheet-cash.util.spec.ts` — `isSheetModifiedAfterClose` true for
  `{ postCloseExpenseCorrectionCount: 1 }` alone.
- `post-close-divergence.spec.ts` — expense-only correction → `diverged: true`,
  `reasons` includes "1 expense correction".
- `monthly-summary-hybrid-cash.spec.ts` — closed sheet with only
  `postCloseExpenseCorrectionCount > 0` → live recompute.
