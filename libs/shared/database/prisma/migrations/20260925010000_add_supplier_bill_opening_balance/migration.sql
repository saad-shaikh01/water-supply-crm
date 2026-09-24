-- Supplier Bill Opening Balance (owner-requested 2026-09-25) — a one-time
-- (editable) seed amount per bucket (Plant/Caps) representing what was already
-- owed to the supplier BEFORE the vendor started tracking deliveries/costs in
-- this software. Without this, SupplierBillService's `prevMonthPending`
-- computes to 0 for any month with no in-system delivery history, so a
-- payment recorded to settle that pre-tracking debt gets wrongly netted
-- against the system-calculated current month's bill instead.
--
-- Purely additive, singleton per vendor (same convention as
-- CashCollectionPolicyConfig) — missing row = zero opening balance, no
-- behaviour change for any vendor until an admin explicitly sets one.

-- CreateTable
CREATE TABLE "SupplierBillOpeningBalance" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "plantAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "capsAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierBillOpeningBalance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierBillOpeningBalance_vendorId_key" ON "SupplierBillOpeningBalance"("vendorId");

-- CreateIndex
CREATE INDEX "SupplierBillOpeningBalance_vendorId_idx" ON "SupplierBillOpeningBalance"("vendorId");

-- AddForeignKey
ALTER TABLE "SupplierBillOpeningBalance" ADD CONSTRAINT "SupplierBillOpeningBalance_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
