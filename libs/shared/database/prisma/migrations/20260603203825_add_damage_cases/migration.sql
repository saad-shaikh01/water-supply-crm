-- CreateEnum
CREATE TYPE "DamageSeverity" AS ENUM ('MINOR', 'MODERATE', 'SEVERE');

-- CreateEnum
CREATE TYPE "DamageCaseStatus" AS ENUM ('REPORTED', 'UNDER_REVIEW', 'CHARGED', 'WAIVED', 'REVERSED');

-- CreateEnum
CREATE TYPE "WriteOffCategory" AS ENUM ('CUSTOMER_NEGLIGENCE', 'NORMAL_WEAR', 'TRANSIT_ACCIDENT', 'UNKNOWN');

-- CreateTable
CREATE TABLE "DamageCase" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "dailySheetItemId" TEXT,
    "severity" "DamageSeverity" NOT NULL,
    "bottleCount" INTEGER NOT NULL,
    "description" TEXT,
    "photoKeys" TEXT[],
    "status" "DamageCaseStatus" NOT NULL DEFAULT 'REPORTED',
    "version" INTEGER NOT NULL DEFAULT 0,
    "chargeAmount" DOUBLE PRECISION,
    "writeOffCategory" "WriteOffCategory",
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "transactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DamageCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DamageCaseAuditLog" (
    "id" TEXT NOT NULL,
    "damageCaseId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DamageCaseAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DamageCase_transactionId_key" ON "DamageCase"("transactionId");

-- CreateIndex
CREATE INDEX "DamageCase_vendorId_status_idx" ON "DamageCase"("vendorId", "status");

-- CreateIndex
CREATE INDEX "DamageCase_customerId_idx" ON "DamageCase"("customerId");

-- CreateIndex
CREATE INDEX "DamageCase_driverId_idx" ON "DamageCase"("driverId");

-- CreateIndex
CREATE UNIQUE INDEX "DamageCase_dailySheetItemId_driverId_severity_vendorId_key" ON "DamageCase"("dailySheetItemId", "driverId", "severity", "vendorId");

-- CreateIndex
CREATE INDEX "DamageCaseAuditLog_damageCaseId_idx" ON "DamageCaseAuditLog"("damageCaseId");

-- CreateIndex
CREATE INDEX "DamageCaseAuditLog_damageCaseId_createdAt_idx" ON "DamageCaseAuditLog"("damageCaseId", "createdAt");

-- AddForeignKey
ALTER TABLE "DamageCase" ADD CONSTRAINT "DamageCase_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DamageCase" ADD CONSTRAINT "DamageCase_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DamageCase" ADD CONSTRAINT "DamageCase_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DamageCase" ADD CONSTRAINT "DamageCase_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DamageCase" ADD CONSTRAINT "DamageCase_dailySheetItemId_fkey" FOREIGN KEY ("dailySheetItemId") REFERENCES "DailySheetItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DamageCase" ADD CONSTRAINT "DamageCase_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DamageCase" ADD CONSTRAINT "DamageCase_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DamageCaseAuditLog" ADD CONSTRAINT "DamageCaseAuditLog_damageCaseId_fkey" FOREIGN KEY ("damageCaseId") REFERENCES "DamageCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
