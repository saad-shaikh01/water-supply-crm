-- Cash Ledger redesign — Phase P0 foundations (owner-approved 2026-09-18).
--
-- 1. VanCashHandover.expectedAmount — the SHEET-derived figure per chain row.
--    `amount` becomes the FINAL APPROVED figure (the ledger truth); the sheet
--    figure lives in `expectedAmount` so the post-close sync can keep reconciling
--    the chain against the sheet (Σ expectedAmount == sheet cashExpected) without
--    undoing an approver's adjustment. variance = amount − expectedAmount.
--
--    Backfill (order matters):
--      a) expectedAmount := the OLD amount (what the sheet said) for every row;
--      b) for APPROVED rows the approver adjusted (approvedAmount differs from
--         amount) amount := approvedAmount. This is the fix for the dead-data bug
--         where approvedAmount was stored but never read by any balance — it
--         changes historical balances on purpose (owner Decision 5); run the
--         restatement report BEFORE applying (scripts/cash-ledger-restatement.ts,
--         a read-only dry run — npm run report:cash-ledger-restatement).
--
-- 2. VanCashOpeningBalance.van FK: CASCADE -> RESTRICT so deleting a van can
--    never silently erase manual cash-in entries.
--
-- 3. Two read-path indexes for the payroll-cash sources the ledger now reads.

-- AlterTable
ALTER TABLE "VanCashHandover" ADD COLUMN "expectedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Backfill (a): expectedAmount := old amount
UPDATE "VanCashHandover" SET "expectedAmount" = "amount";

-- Backfill (b): amount := final approved amount where the approver adjusted it
UPDATE "VanCashHandover"
SET "amount" = "approvedAmount"
WHERE "status" = 'APPROVED'
  AND "approvedAmount" IS NOT NULL
  AND "approvedAmount" <> "amount";

-- DropForeignKey / AddForeignKey
ALTER TABLE "VanCashOpeningBalance" DROP CONSTRAINT "VanCashOpeningBalance_vanId_fkey";
ALTER TABLE "VanCashOpeningBalance" ADD CONSTRAINT "VanCashOpeningBalance_vanId_fkey" FOREIGN KEY ("vanId") REFERENCES "Van"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "StaffLedgerEntry_vendorId_category_effectiveDate_idx" ON "StaffLedgerEntry"("vendorId", "category", "effectiveDate");

-- CreateIndex
CREATE INDEX "Settlement_vendorId_method_paidAt_idx" ON "Settlement"("vendorId", "method", "paidAt");
