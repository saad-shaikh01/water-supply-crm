-- Historical Product Cost & COGS
-- (docs/features/product-cost-history-and-cogs.md).
--
-- Versioned, effective-dated plant cost per product ("what the plant charges
-- per unit, as of a given calendar date"). Same append-only shape as
-- SalaryStructure, generalized so a later insert can also split/trim an
-- existing range for a true backdated correction (see ProductCostService).
-- COGS is computed from this table at report time only — nothing here is
-- ever stamped onto DailySheetItem/Transaction/Expense.
--
-- Purely additive: one new table + one new enum, no existing table altered,
-- no data backfill (every vendor starts with zero rows). Safe to run in one
-- transaction (no enum-value reuse).

-- CreateEnum
CREATE TYPE "ProductCostSource" AS ENUM ('MANUAL');

-- CreateTable
CREATE TABLE "ProductCost" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "costPerUnit" DOUBLE PRECISION NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "note" TEXT,
    "invoiceRef" TEXT,
    "source" "ProductCostSource" NOT NULL DEFAULT 'MANUAL',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,

    CONSTRAINT "ProductCost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductCost_vendorId_productId_effectiveFrom_idx" ON "ProductCost"("vendorId", "productId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCost_vendorId_productId_effectiveFrom_key" ON "ProductCost"("vendorId", "productId", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "ProductCost" ADD CONSTRAINT "ProductCost_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCost" ADD CONSTRAINT "ProductCost_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCost" ADD CONSTRAINT "ProductCost_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCost" ADD CONSTRAINT "ProductCost_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
