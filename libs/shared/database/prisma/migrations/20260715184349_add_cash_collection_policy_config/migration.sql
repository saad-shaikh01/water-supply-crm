-- CreateTable
CREATE TABLE "CashCollectionPolicyConfig" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "allowedCreditDeliveries" INTEGER NOT NULL DEFAULT 2,
    "minExposureFloor" DOUBLE PRECISION NOT NULL DEFAULT 500,
    "maxOutstandingCeiling" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashCollectionPolicyConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CashCollectionPolicyConfig_vendorId_key" ON "CashCollectionPolicyConfig"("vendorId");

-- CreateIndex
CREATE INDEX "CashCollectionPolicyConfig_vendorId_idx" ON "CashCollectionPolicyConfig"("vendorId");

-- AddForeignKey
ALTER TABLE "CashCollectionPolicyConfig" ADD CONSTRAINT "CashCollectionPolicyConfig_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
