-- AlterTable: filled bottles received back from the customer (account closing /
-- excess stock return) — separate from emptyReceived (which needs refill/wash).
ALTER TABLE "DailySheetItem" ADD COLUMN "filledReceived" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: mirror on Transaction so historical ledger rows are self-describing.
ALTER TABLE "Transaction" ADD COLUMN "filledReceived" INTEGER;
