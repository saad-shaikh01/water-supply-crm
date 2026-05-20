/*
  Warnings:

  - Added the required column `updatedAt` to the `AuditLog` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE INDEX "CustomerOrder_customerId_status_idx" ON "CustomerOrder"("customerId", "status");

-- CreateIndex
CREATE INDEX "DailySheet_vanId_date_idx" ON "DailySheet"("vanId", "date");

-- CreateIndex
CREATE INDEX "DailySheetItem_customerId_status_idx" ON "DailySheetItem"("customerId", "status");

-- CreateIndex
CREATE INDEX "DailySheetLoad_dailySheetId_tripNumber_idx" ON "DailySheetLoad"("dailySheetId", "tripNumber");

-- CreateIndex
CREATE INDEX "DeliveryIssue_assignedVanId_idx" ON "DeliveryIssue"("assignedVanId");

-- CreateIndex
CREATE INDEX "PaymentRequest_vendorId_createdAt_idx" ON "PaymentRequest"("vendorId", "createdAt");

-- CreateIndex
CREATE INDEX "Product_vendorId_name_idx" ON "Product"("vendorId", "name");

-- CreateIndex
CREATE INDEX "Transaction_vendorId_type_createdAt_idx" ON "Transaction"("vendorId", "type", "createdAt");
