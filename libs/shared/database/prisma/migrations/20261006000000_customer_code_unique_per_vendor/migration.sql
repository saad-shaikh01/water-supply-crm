-- Customer codes are now unique PER VENDOR (every vendor's codes start at L1) instead of globally.
-- Existing codes were globally unique, so they trivially satisfy the new (vendorId, customerCode)
-- constraint: no data change, no code is renumbered. The new unique index is created BEFORE the old
-- one is dropped so uniqueness is never unenforced.

-- CreateIndex
CREATE UNIQUE INDEX "Customer_vendorId_customerCode_key" ON "Customer"("vendorId", "customerCode");

-- CreateIndex (the public portal-activation flow looks a customer up by code alone)
CREATE INDEX "Customer_customerCode_idx" ON "Customer"("customerCode");

-- DropIndex
DROP INDEX "Customer_customerCode_key";
