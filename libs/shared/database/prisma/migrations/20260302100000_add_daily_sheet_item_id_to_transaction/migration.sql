-- AlterTable: link Transaction rows to the individual DailySheetItem that generated them
-- This enables idempotent re-posting when a completed delivery is edited.
ALTER TABLE "Transaction" ADD COLUMN "dailySheetItemId" TEXT;

-- CreateIndex
CREATE INDEX "Transaction_dailySheetItemId_idx" ON "Transaction"("dailySheetItemId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_dailySheetItemId_fkey"
  FOREIGN KEY ("dailySheetItemId") REFERENCES "DailySheetItem"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
