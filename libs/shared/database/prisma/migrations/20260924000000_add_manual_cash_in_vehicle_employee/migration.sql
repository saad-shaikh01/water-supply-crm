-- Manual Cash In — vehicle-rent / labour-lent income (owner request 2026-09-24).
--
-- The reverse of the existing VEHICLE_RENT / EXTRA_LABOUR EXPENSE categories:
-- cash the business COLLECTED for renting out one of its own vehicles, or
-- lending out its own staff, to another business. Recorded through the
-- existing "Add Cash In" (manual cash-in) flow with two new `source` values,
-- each carrying a mandatory, exclusive reference to WHICH vehicle / employee
-- earned the income so it can be filtered/reported on later.
--
-- Purely additive: two new enum values + two new nullable FK columns + two
-- new indexes on the existing VanCashOpeningBalance table. No existing rows
-- or values touched.

-- AlterEnum
ALTER TYPE "ManualCashInSource" ADD VALUE 'VEHICLE_RENTED_OUT';
ALTER TYPE "ManualCashInSource" ADD VALUE 'LABOUR_LENT_OUT';

-- AlterTable
ALTER TABLE "VanCashOpeningBalance" ADD COLUMN "relatedVehicleId" TEXT;
ALTER TABLE "VanCashOpeningBalance" ADD COLUMN "relatedEmployeeId" TEXT;

-- CreateIndex
CREATE INDEX "VanCashOpeningBalance_vendorId_relatedVehicleId_idx" ON "VanCashOpeningBalance"("vendorId", "relatedVehicleId");

-- CreateIndex
CREATE INDEX "VanCashOpeningBalance_vendorId_relatedEmployeeId_idx" ON "VanCashOpeningBalance"("vendorId", "relatedEmployeeId");

-- AddForeignKey
ALTER TABLE "VanCashOpeningBalance" ADD CONSTRAINT "VanCashOpeningBalance_relatedVehicleId_fkey" FOREIGN KEY ("relatedVehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VanCashOpeningBalance" ADD CONSTRAINT "VanCashOpeningBalance_relatedEmployeeId_fkey" FOREIGN KEY ("relatedEmployeeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
