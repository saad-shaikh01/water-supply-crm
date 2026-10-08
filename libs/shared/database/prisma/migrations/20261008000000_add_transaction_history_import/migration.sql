-- Transaction-history import (additive only)
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'HISTORICAL';
ALTER TYPE "ImportEntity" ADD VALUE IF NOT EXISTS 'TRANSACTION_HISTORY';
ALTER TYPE "ImportBatchStatus" ADD VALUE IF NOT EXISTS 'PLANNING';

ALTER TABLE "ImportRow" ADD COLUMN "dedupeKey" TEXT;
CREATE INDEX "ImportRow_dedupeKey_idx" ON "ImportRow"("dedupeKey");
