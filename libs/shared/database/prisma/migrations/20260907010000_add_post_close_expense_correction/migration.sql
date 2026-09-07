-- Post-Close Expense Correction (docs/features/post-close-expense-correction.md).
--
-- Adds a single marker column to DailySheet, incremented by every edit / void /
-- add applied to a CLOSED sheet's Expense rows through the dedicated
-- /expenses/:id/correct, /expenses/:id/void and /expenses/closed endpoints.
--
-- Like the Void Delivery / Post-Close Trip Correction siblings, those endpoints
-- deliberately never rewrite the frozen close-time cashExpected / cashCollected
-- columns; this counter lets the post-close divergence banner and the hybrid
-- cash rollups (dashboard / analytics / driver stats) detect that a closed
-- sheet's live expense total no longer matches its snapshot and switch that one
-- sheet to a live recompute.
--
-- Purely additive: NOT NULL with a DEFAULT 0, so it is safe to run in one
-- transaction against a live database.

-- AlterTable
ALTER TABLE "DailySheet" ADD COLUMN "postCloseExpenseCorrectionCount" INTEGER NOT NULL DEFAULT 0;
