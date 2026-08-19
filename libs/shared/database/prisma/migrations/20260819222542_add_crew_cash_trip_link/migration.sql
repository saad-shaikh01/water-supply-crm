-- AlterTable
ALTER TABLE "CrewCashDistribution" ADD COLUMN     "dailySheetLoadId" TEXT;

-- CreateIndex
CREATE INDEX "CrewCashDistribution_dailySheetLoadId_idx" ON "CrewCashDistribution"("dailySheetLoadId");

-- AddForeignKey
ALTER TABLE "CrewCashDistribution" ADD CONSTRAINT "CrewCashDistribution_dailySheetLoadId_fkey" FOREIGN KEY ("dailySheetLoadId") REFERENCES "DailySheetLoad"("id") ON DELETE SET NULL ON UPDATE CASCADE;
