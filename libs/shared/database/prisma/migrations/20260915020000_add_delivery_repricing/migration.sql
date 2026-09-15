-- Bulk Closed Delivery Repricing (owner-requested 2026-09-15).
--
-- Problem: vendors periodically raise the per-bottle rate for everyone. Some
-- customers refuse the new rate after several deliveries already went out at
-- the higher one, and management ends up approving keeping them on the old
-- rate. By then those DailySheetItem rows are on CLOSED sheets, and every
-- downstream figure (customer balance, Transaction ledger, revenue reports,
-- the statement) already reflects the higher rate.
--
-- Fix: a dedicated batch/item pair, deliberately SEPARATE from the existing
-- single-item "Correct Closed-Sheet Delivery" flow (isCorrection/
-- correctionNote), because that flow means "this was a driver mistake" while
-- a reprice is a management-approved business decision spanning possibly
-- several closed deliveries/sheets for one customer at once. Gives a durable,
-- queryable audit trail (old/new rate, old/new amount, difference, reason,
-- who/when) beyond what a generic AuditLog JSON blob offers, mirroring the
-- RepairBatch / WarehouseTransaction parent-child precedent.
--
-- DailySheetItem gains its own isRepriced/repricedAt marker pair (NOT
-- isCorrection/correctionAddedAt) so the post-close divergence predicate in
-- sheet-cash.util.ts can flag a repriced sheet the same way it already flags
-- a corrected one, without conflating the two flows.
--
-- Purely additive: two new tables, two new nullable/defaulted columns on
-- DailySheetItem. No existing table is altered destructively.

-- AlterTable
ALTER TABLE "DailySheetItem" ADD COLUMN "isRepriced" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DailySheetItem" ADD COLUMN "repricedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "DeliveryRepricingBatch" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "newPricePerBottle" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "itemCount" INTEGER NOT NULL,
    "totalDifference" DOUBLE PRECISION NOT NULL,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryRepricingBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryRepricingItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "dailySheetItemId" TEXT NOT NULL,
    "dailySheetId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "oldPricePerBottle" DOUBLE PRECISION NOT NULL,
    "newPricePerBottle" DOUBLE PRECISION NOT NULL,
    "oldAmount" DOUBLE PRECISION NOT NULL,
    "newAmount" DOUBLE PRECISION NOT NULL,
    "difference" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryRepricingItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeliveryRepricingBatch_vendorId_customerId_idx" ON "DeliveryRepricingBatch"("vendorId", "customerId");

-- CreateIndex
CREATE INDEX "DeliveryRepricingBatch_vendorId_createdAt_idx" ON "DeliveryRepricingBatch"("vendorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryRepricingItem_batchId_dailySheetItemId_key" ON "DeliveryRepricingItem"("batchId", "dailySheetItemId");

-- CreateIndex
CREATE INDEX "DeliveryRepricingItem_dailySheetItemId_idx" ON "DeliveryRepricingItem"("dailySheetItemId");

-- AddForeignKey
ALTER TABLE "DeliveryRepricingBatch" ADD CONSTRAINT "DeliveryRepricingBatch_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRepricingBatch" ADD CONSTRAINT "DeliveryRepricingBatch_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRepricingBatch" ADD CONSTRAINT "DeliveryRepricingBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRepricingItem" ADD CONSTRAINT "DeliveryRepricingItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "DeliveryRepricingBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRepricingItem" ADD CONSTRAINT "DeliveryRepricingItem_dailySheetItemId_fkey" FOREIGN KEY ("dailySheetItemId") REFERENCES "DailySheetItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
