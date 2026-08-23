-- Odometer Correction feature (owner request, 2026-08-23): Staff/Admin can
-- now fix a mis-entered odometer reading on an already-submitted vehicle
-- daily check instead of it being permanently locked. Additive only — no
-- existing rows/columns touched. `originalOdometerReading` stays NULL until
-- the first edit (application layer sets it once, then never overwrites it),
-- so "was this ever corrected?" is answerable directly from NULL-ness.
--
-- NOT yet applied/verified against a live DB in this environment (same
-- Postgres-unreachable situation as the 20260821010000 migration before it)
-- — run `prisma migrate deploy` before this ships.

-- AlterTable
ALTER TABLE "VehicleDailyCheck"
  ADD COLUMN "originalOdometerReading" INTEGER,
  ADD COLUMN "odometerEditedById" TEXT,
  ADD COLUMN "odometerEditedAt" TIMESTAMP(3),
  ADD COLUMN "odometerEditReason" TEXT;

-- AddForeignKey
ALTER TABLE "VehicleDailyCheck"
  ADD CONSTRAINT "VehicleDailyCheck_odometerEditedById_fkey"
  FOREIGN KEY ("odometerEditedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
