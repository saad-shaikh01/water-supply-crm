-- Fleet Operations & Vehicle Intelligence — §17 Amendment (2026-08-21)
--
-- Splits the physical-vehicle identity (plate, make/model, documents,
-- odometer, fuel, maintenance) out of `Van` (which stays the route/slot
-- identity — "Van1", "Van2"...) into a new `Vehicle` table. Zero data loss:
-- one `Vehicle` row is backfilled per existing `Van` row, reusing the same
-- id (Vehicle.id = Van.id) so every existing vanId value on the five
-- vehicle-specific Fleet tables can be copied straight across to vehicleId
-- with a single `SET vehicleId = vanId` per table — no join, no ambiguity,
-- no rows lost. `VehicleDailyCheck` keeps `vanId` (still the route this
-- trip belongs to) and gains a new, nullable `vehicleId` that is
-- intentionally left NULL on this migration for all historical rows (§17.5,
-- locked: no retroactive plate-history backfill is possible) — it is
-- required going forward by the service/DTO layer only, not by the schema.
--
-- IMPORTANT: this migration could not be applied or verified against a live
-- database in this environment (local Postgres was unreachable). It was
-- authored by hand-sequencing a `prisma migrate diff` structural diff with
-- the extra data-migration steps below (see steps 2 and 6). Please run
-- `npx prisma migrate deploy` against a real/staging database and verify
-- row counts before/after (see verification queries at the bottom of this
-- file, kept as comments) before this reaches production.
--
-- DEVIATION FROM §17.2's letter (implementer judgment call — see the long
-- comment on the Van model in schema.prisma): Van.plateNumber is NOT
-- dropped by this migration, unlike every other table's vanId column. ~15
-- backend modules outside this task's scope still read it as Van's only
-- human-readable label; dropping it would break their TypeScript
-- compilation or require editing explicitly out-of-scope files
-- (daily-sheets/** above all). See Step 8 below (intentionally a no-op).

-- ============================================================================
-- Step 1: Create the new Vehicle table (no NOT NULL data-dependent
-- constraints yet — those are added after backfill in Step 3).
-- ============================================================================

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "plateNumber" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "usualVanId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- Step 2: Data migration — one Vehicle row per existing Van row.
-- Vehicle.id is deliberately set equal to the source Van.id: this makes the
-- FK remap in Step 6 a trivial `vehicleId = vanId` copy per table, with no
-- join and no risk of mismatched rows. usualVanId is set to that same Van's
-- id (the vehicle's "usual" route defaults to the route it has always run).
-- ============================================================================

INSERT INTO "Vehicle" ("id", "vendorId", "plateNumber", "isActive", "usualVanId", "createdAt", "updatedAt")
SELECT "id", "vendorId", "plateNumber", "isActive", "id", "createdAt", "updatedAt"
FROM "Van";

-- ============================================================================
-- Step 3: Constraints/indexes on Vehicle, now that data is unique-safe
-- (copied straight from Van's own pre-existing global-unique plateNumber).
-- ============================================================================

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_plateNumber_key" ON "Vehicle"("plateNumber");

-- CreateIndex
CREATE INDEX "Vehicle_vendorId_idx" ON "Vehicle"("vendorId");

-- CreateIndex
CREATE INDEX "Vehicle_usualVanId_idx" ON "Vehicle"("usualVanId");

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_usualVanId_fkey" FOREIGN KEY ("usualVanId") REFERENCES "Van"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- Step 4: Add nullable vehicleId columns to every vehicle-specific Fleet
-- table (plus VehicleDailyCheck, which keeps vanId too).
-- ============================================================================

-- AlterTable
ALTER TABLE "VehicleProfile" ADD COLUMN "vehicleId" TEXT;

-- AlterTable
ALTER TABLE "VehicleDocument" ADD COLUMN "vehicleId" TEXT;

-- AlterTable
ALTER TABLE "FuelLog" ADD COLUMN "vehicleId" TEXT;

-- AlterTable
ALTER TABLE "VehicleMaintenanceRule" ADD COLUMN "vehicleId" TEXT;

-- AlterTable
ALTER TABLE "VehicleServiceRecord" ADD COLUMN "vehicleId" TEXT;

-- AlterTable — VehicleDailyCheck.vanId is UNCHANGED; vehicleId is new and
-- stays nullable at the schema level (historical rows intentionally left
-- NULL, per §17.5 — no backfill is possible).
ALTER TABLE "VehicleDailyCheck" ADD COLUMN "vehicleId" TEXT;

-- ============================================================================
-- Step 5: Backfill vehicleId = vanId on the five vehicle-specific tables
-- (mechanical remap, same ids in a new column, zero rows lost — see plan
-- doc §17.4 step 3). VehicleDailyCheck is deliberately NOT backfilled here.
-- ============================================================================

UPDATE "VehicleProfile" SET "vehicleId" = "vanId";
UPDATE "VehicleDocument" SET "vehicleId" = "vanId";
UPDATE "FuelLog" SET "vehicleId" = "vanId";
UPDATE "VehicleMaintenanceRule" SET "vehicleId" = "vanId";
UPDATE "VehicleServiceRecord" SET "vehicleId" = "vanId";

-- ============================================================================
-- Step 6: Drop the old vanId FKs/indexes, drop the vanId columns, enforce
-- NOT NULL on the now-backfilled vehicleId columns, and add the new
-- vehicleId FKs/indexes.
-- ============================================================================

-- DropForeignKey
ALTER TABLE "VehicleProfile" DROP CONSTRAINT "VehicleProfile_vanId_fkey";

-- DropForeignKey
ALTER TABLE "VehicleDocument" DROP CONSTRAINT "VehicleDocument_vanId_fkey";

-- DropForeignKey
ALTER TABLE "FuelLog" DROP CONSTRAINT "FuelLog_vanId_fkey";

-- DropForeignKey
ALTER TABLE "VehicleMaintenanceRule" DROP CONSTRAINT "VehicleMaintenanceRule_vanId_fkey";

-- DropForeignKey
ALTER TABLE "VehicleServiceRecord" DROP CONSTRAINT "VehicleServiceRecord_vanId_fkey";

-- DropIndex
DROP INDEX "VehicleProfile_vanId_key";

-- DropIndex
DROP INDEX "VehicleDocument_vendorId_vanId_idx";

-- DropIndex
DROP INDEX "FuelLog_vendorId_vanId_date_idx";

-- DropIndex
DROP INDEX "VehicleMaintenanceRule_vendorId_vanId_idx";

-- DropIndex
DROP INDEX "VehicleMaintenanceRule_vanId_serviceType_key";

-- DropIndex
DROP INDEX "VehicleServiceRecord_vendorId_vanId_serviceType_idx";

-- AlterTable
ALTER TABLE "VehicleProfile" DROP COLUMN "vanId",
ALTER COLUMN "vehicleId" SET NOT NULL;

-- AlterTable
ALTER TABLE "VehicleDocument" DROP COLUMN "vanId",
ALTER COLUMN "vehicleId" SET NOT NULL;

-- AlterTable
ALTER TABLE "FuelLog" DROP COLUMN "vanId",
ALTER COLUMN "vehicleId" SET NOT NULL;

-- AlterTable
ALTER TABLE "VehicleMaintenanceRule" DROP COLUMN "vanId",
ALTER COLUMN "vehicleId" SET NOT NULL;

-- AlterTable
ALTER TABLE "VehicleServiceRecord" DROP COLUMN "vanId",
ALTER COLUMN "vehicleId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "VehicleProfile_vehicleId_key" ON "VehicleProfile"("vehicleId");

-- CreateIndex
CREATE INDEX "VehicleDocument_vendorId_vehicleId_idx" ON "VehicleDocument"("vendorId", "vehicleId");

-- CreateIndex
CREATE INDEX "FuelLog_vendorId_vehicleId_date_idx" ON "FuelLog"("vendorId", "vehicleId", "date");

-- CreateIndex
CREATE INDEX "VehicleMaintenanceRule_vendorId_vehicleId_idx" ON "VehicleMaintenanceRule"("vendorId", "vehicleId");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleMaintenanceRule_vehicleId_serviceType_key" ON "VehicleMaintenanceRule"("vehicleId", "serviceType");

-- CreateIndex
CREATE INDEX "VehicleServiceRecord_vendorId_vehicleId_serviceType_idx" ON "VehicleServiceRecord"("vendorId", "vehicleId", "serviceType");

-- AddForeignKey
ALTER TABLE "VehicleProfile" ADD CONSTRAINT "VehicleProfile_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleDocument" ADD CONSTRAINT "VehicleDocument_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelLog" ADD CONSTRAINT "FuelLog_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleMaintenanceRule" ADD CONSTRAINT "VehicleMaintenanceRule_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleServiceRecord" ADD CONSTRAINT "VehicleServiceRecord_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- Step 7: VehicleDailyCheck — index + FK for the new (nullable) vehicleId.
-- vanId is untouched.
-- ============================================================================

-- CreateIndex
CREATE INDEX "VehicleDailyCheck_vendorId_vehicleId_recordedAt_idx" ON "VehicleDailyCheck"("vendorId", "vehicleId", "recordedAt");

-- AddForeignKey
ALTER TABLE "VehicleDailyCheck" ADD CONSTRAINT "VehicleDailyCheck_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- Step 8 — INTENTIONALLY SKIPPED (implementer judgment call, see the long
-- comment on the Van model in schema.prisma for the full reasoning): §17.2
-- says Van.plateNumber "moves to Vehicle" and Van keeps only route-stable
-- fields. That is honored for every Fleet table (all five now key off the
-- new Vehicle.plateNumber above). However Van.plateNumber itself is NOT
-- dropped here, because ~15 other backend modules outside this task's scope
-- (daily sheets, customers, routes, expenses, tracking, delivery issues,
-- communication, analytics, sheet-discrepancy-cases, users) still
-- `select`/display it as Van's only human-readable label, and dropping the
-- column would break TypeScript compilation across all of them or require
-- touching explicitly-out-of-scope files (daily-sheets/** above all).
-- Van.plateNumber is kept as a legacy/display-only field; retiring it is a
-- follow-up task, not part of this migration.
-- ============================================================================
-- Verification queries (run manually before/after applying in a real
-- environment — NOT executed by this migration):
--
--   SELECT count(*) FROM "Van";                     -- should equal:
--   SELECT count(*) FROM "Vehicle";                  -- this count
--
--   SELECT count(*) FROM "VehicleProfile" WHERE "vehicleId" IS NULL;        -- expect 0
--   SELECT count(*) FROM "VehicleDocument" WHERE "vehicleId" IS NULL;       -- expect 0
--   SELECT count(*) FROM "FuelLog" WHERE "vehicleId" IS NULL;               -- expect 0
--   SELECT count(*) FROM "VehicleMaintenanceRule" WHERE "vehicleId" IS NULL;-- expect 0
--   SELECT count(*) FROM "VehicleServiceRecord" WHERE "vehicleId" IS NULL;  -- expect 0
--
--   -- Historical checks intentionally left unlinked (§17.5):
--   SELECT count(*) FROM "VehicleDailyCheck" WHERE "vehicleId" IS NULL;
-- ============================================================================
