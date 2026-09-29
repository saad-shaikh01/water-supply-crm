-- Customer Flags (owner-requested 2026-09-29): highlight a customer with an
-- admin-defined category (e.g. "To Be Closed", "Payment Overdue") so staff
-- see why wherever that customer is displayed (list, daily-sheet delivery
-- rows, Communication Center). Two-tier: CustomerFlagCategory is the
-- admin-managed catalogue (color + default message), CustomerFlag is one
-- applied instance on a customer, resolved (never deleted) when cleared.
--
-- Purely additive: two new tables + one new enum. No existing table altered,
-- no data backfill.

-- CreateEnum
CREATE TYPE "CustomerFlagStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateTable
CREATE TABLE "CustomerFlagCategory" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "defaultMessage" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerFlagCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerFlag" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "CustomerFlagStatus" NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedById" TEXT,
    "resolvedByName" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedReason" TEXT,

    CONSTRAINT "CustomerFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerFlagCategory_vendorId_idx" ON "CustomerFlagCategory"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerFlagCategory_vendorId_name_key" ON "CustomerFlagCategory"("vendorId", "name");

-- CreateIndex
CREATE INDEX "CustomerFlag_vendorId_customerId_status_idx" ON "CustomerFlag"("vendorId", "customerId", "status");

-- CreateIndex
CREATE INDEX "CustomerFlag_vendorId_categoryId_idx" ON "CustomerFlag"("vendorId", "categoryId");

-- AddForeignKey
ALTER TABLE "CustomerFlagCategory" ADD CONSTRAINT "CustomerFlagCategory_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerFlag" ADD CONSTRAINT "CustomerFlag_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerFlag" ADD CONSTRAINT "CustomerFlag_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerFlag" ADD CONSTRAINT "CustomerFlag_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "CustomerFlagCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
