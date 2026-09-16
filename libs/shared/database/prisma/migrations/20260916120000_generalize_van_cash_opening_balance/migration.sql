-- Generalizes VanCashOpeningBalance from "one row per van" into a repeatable
-- manual cash-in entry (owner-requested 2026-09-16): any number of dated
-- entries, each optionally tied to a van. Lets it serve both the one-time
-- historical balance backfill (Google Sheet migration) and any future
-- off-cycle cash injection that doesn't come through a driver handover.

-- DropForeignKey
ALTER TABLE "VanCashOpeningBalance" DROP CONSTRAINT "VanCashOpeningBalance_vanId_fkey";

-- DropIndex
DROP INDEX "VanCashOpeningBalance_vanId_key";

-- AlterTable
ALTER TABLE "VanCashOpeningBalance" ALTER COLUMN "vanId" DROP NOT NULL,
ADD COLUMN "note" TEXT;

-- CreateIndex
CREATE INDEX "VanCashOpeningBalance_vanId_idx" ON "VanCashOpeningBalance"("vanId");

-- AddForeignKey
ALTER TABLE "VanCashOpeningBalance" ADD CONSTRAINT "VanCashOpeningBalance_vanId_fkey" FOREIGN KEY ("vanId") REFERENCES "Van"("id") ON DELETE CASCADE ON UPDATE CASCADE;
