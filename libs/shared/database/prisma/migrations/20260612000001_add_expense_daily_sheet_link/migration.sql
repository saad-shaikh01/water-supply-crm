-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "dailySheetId" TEXT;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_dailySheetId_fkey" FOREIGN KEY ("dailySheetId") REFERENCES "DailySheet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "Expense_dailySheetId_idx" ON "Expense"("dailySheetId");
