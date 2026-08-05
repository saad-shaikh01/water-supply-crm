-- Per-vendor toggle for the nightly warehouse auto-refill sweep (empty -> filled).
-- Missing row / enabled=false = unchanged manual-only Refill behavior.

-- AlterEnum
ALTER TYPE "WarehouseTransactionType" ADD VALUE 'AUTO_REFILL';

-- CreateTable
CREATE TABLE "WarehouseAutoRefillConfig" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarehouseAutoRefillConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseAutoRefillConfig_vendorId_key" ON "WarehouseAutoRefillConfig"("vendorId");

-- CreateIndex
CREATE INDEX "WarehouseAutoRefillConfig_vendorId_idx" ON "WarehouseAutoRefillConfig"("vendorId");

-- AddForeignKey
ALTER TABLE "WarehouseAutoRefillConfig" ADD CONSTRAINT "WarehouseAutoRefillConfig_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
