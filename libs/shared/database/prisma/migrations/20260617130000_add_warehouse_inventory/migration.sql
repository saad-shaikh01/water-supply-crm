-- CreateEnum
CREATE TYPE "WarehouseTransactionType" AS ENUM ('OPENING_BALANCE', 'FILL_IN', 'LOAD_OUT', 'CHECK_IN_FILLED', 'CHECK_IN_EMPTY', 'CHECK_IN_DAMAGED', 'CHECK_IN_LEAKED', 'REFILL', 'MARK_DAMAGED', 'MARK_LEAKED', 'SEND_REPAIR', 'RETURN_REPAIR', 'WRITE_OFF', 'DISCREPANCY_ADJUST', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "RepairBatchStatus" AS ENUM ('SENT', 'PARTIALLY_RETURNED', 'COMPLETED');

-- AlterTable
ALTER TABLE "DailySheetLoad" ADD COLUMN "productId" TEXT,
ADD COLUMN "damagedOnVan" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "leakedOnVan" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "WarehouseStock" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "filledCount" INTEGER NOT NULL DEFAULT 0,
    "emptyCount" INTEGER NOT NULL DEFAULT 0,
    "damagedCount" INTEGER NOT NULL DEFAULT 0,
    "leakedCount" INTEGER NOT NULL DEFAULT 0,
    "inRepairCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarehouseStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseTransaction" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "type" "WarehouseTransactionType" NOT NULL,
    "filledDelta" INTEGER NOT NULL DEFAULT 0,
    "emptyDelta" INTEGER NOT NULL DEFAULT 0,
    "damagedDelta" INTEGER NOT NULL DEFAULT 0,
    "leakedDelta" INTEGER NOT NULL DEFAULT 0,
    "repairDelta" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "dailySheetId" TEXT,
    "repairBatchId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepairBatch" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "shopName" TEXT NOT NULL,
    "bottlesSent" INTEGER NOT NULL,
    "bottlesReturned" INTEGER NOT NULL DEFAULT 0,
    "bottlesWrittenOff" INTEGER NOT NULL DEFAULT 0,
    "status" "RepairBatchStatus" NOT NULL DEFAULT 'SENT',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "returnedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT,

    CONSTRAINT "RepairBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WarehouseStock_vendorId_idx" ON "WarehouseStock"("vendorId");
CREATE UNIQUE INDEX "WarehouseStock_vendorId_productId_key" ON "WarehouseStock"("vendorId", "productId");

-- CreateIndex
CREATE INDEX "WarehouseTransaction_vendorId_createdAt_idx" ON "WarehouseTransaction"("vendorId", "createdAt");
CREATE INDEX "WarehouseTransaction_vendorId_type_idx" ON "WarehouseTransaction"("vendorId", "type");
CREATE INDEX "WarehouseTransaction_productId_idx" ON "WarehouseTransaction"("productId");
CREATE INDEX "WarehouseTransaction_dailySheetId_idx" ON "WarehouseTransaction"("dailySheetId");

-- CreateIndex
CREATE INDEX "RepairBatch_vendorId_idx" ON "RepairBatch"("vendorId");
CREATE INDEX "RepairBatch_vendorId_status_idx" ON "RepairBatch"("vendorId", "status");

-- CreateIndex
CREATE INDEX "DailySheetLoad_productId_idx" ON "DailySheetLoad"("productId");

-- AddForeignKey
ALTER TABLE "DailySheetLoad" ADD CONSTRAINT "DailySheetLoad_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseStock" ADD CONSTRAINT "WarehouseStock_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseStock" ADD CONSTRAINT "WarehouseStock_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseTransaction" ADD CONSTRAINT "WarehouseTransaction_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseTransaction" ADD CONSTRAINT "WarehouseTransaction_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseTransaction" ADD CONSTRAINT "WarehouseTransaction_dailySheetId_fkey" FOREIGN KEY ("dailySheetId") REFERENCES "DailySheet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WarehouseTransaction" ADD CONSTRAINT "WarehouseTransaction_repairBatchId_fkey" FOREIGN KEY ("repairBatchId") REFERENCES "RepairBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WarehouseTransaction" ADD CONSTRAINT "WarehouseTransaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairBatch" ADD CONSTRAINT "RepairBatch_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RepairBatch" ADD CONSTRAINT "RepairBatch_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RepairBatch" ADD CONSTRAINT "RepairBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
