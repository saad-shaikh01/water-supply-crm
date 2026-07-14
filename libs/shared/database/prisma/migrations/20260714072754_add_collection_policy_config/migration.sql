-- CreateTable
CREATE TABLE "CollectionPolicyConfig" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "minOutstandingThreshold" DOUBLE PRECISION NOT NULL DEFAULT 1000,
    "minCollectionPercentage" DOUBLE PRECISION NOT NULL DEFAULT 90,
    "allowedShortfall" DOUBLE PRECISION NOT NULL DEFAULT 300,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectionPolicyConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CollectionPolicyConfig_vendorId_key" ON "CollectionPolicyConfig"("vendorId");

-- CreateIndex
CREATE INDEX "CollectionPolicyConfig_vendorId_idx" ON "CollectionPolicyConfig"("vendorId");

-- AddForeignKey
ALTER TABLE "CollectionPolicyConfig" ADD CONSTRAINT "CollectionPolicyConfig_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
