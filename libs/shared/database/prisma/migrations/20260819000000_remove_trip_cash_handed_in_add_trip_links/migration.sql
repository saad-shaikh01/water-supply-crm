-- Trip feature: cash hand-in is no longer tracked per-trip at check-in time
-- (DailySheetLoad.cashHandedIn is dropped). Instead the driver reports one
-- actual cash figure at sheet close (DailySheet.cashCollected, written once
-- by closeSheet()/requestClose() instead of incrementally by checkinLoad()).
-- Delivery items and expenses now carry a nullable link to the trip
-- (DailySheetLoad) they were recorded/incurred under, so a trip's contents
-- can be reconstructed after the fact even though cash itself is no longer
-- attributed per-trip.

ALTER TABLE "DailySheetLoad" DROP COLUMN "cashHandedIn";

ALTER TABLE "DailySheetItem" ADD COLUMN "dailySheetLoadId" TEXT;
ALTER TABLE "Expense" ADD COLUMN "dailySheetLoadId" TEXT;

-- CreateIndex
CREATE INDEX "DailySheetItem_dailySheetLoadId_idx" ON "DailySheetItem"("dailySheetLoadId");

-- CreateIndex
CREATE INDEX "Expense_dailySheetLoadId_idx" ON "Expense"("dailySheetLoadId");

-- AddForeignKey
ALTER TABLE "DailySheetItem" ADD CONSTRAINT "DailySheetItem_dailySheetLoadId_fkey"
  FOREIGN KEY ("dailySheetLoadId") REFERENCES "DailySheetLoad"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_dailySheetLoadId_fkey"
  FOREIGN KEY ("dailySheetLoadId") REFERENCES "DailySheetLoad"("id") ON DELETE SET NULL ON UPDATE CASCADE;
