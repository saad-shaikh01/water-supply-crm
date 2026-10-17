-- Van.plateNumber and Vehicle.plateNumber were unique GLOBALLY, so two different
-- vendors' fleets could not coincidentally share a route label ("Van1") or a real
-- plate number. Both are now unique PER VENDOR instead. Existing plate numbers
-- were globally unique, so they trivially satisfy the new (vendorId, plateNumber)
-- constraint: no data change. The new unique indexes are created BEFORE the old
-- ones are dropped so uniqueness is never unenforced.

-- CreateIndex
CREATE UNIQUE INDEX "Van_vendorId_plateNumber_key" ON "Van"("vendorId", "plateNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_vendorId_plateNumber_key" ON "Vehicle"("vendorId", "plateNumber");

-- DropIndex
DROP INDEX "Van_plateNumber_key";

-- DropIndex
DROP INDEX "Vehicle_plateNumber_key";
