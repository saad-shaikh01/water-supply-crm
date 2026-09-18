-- Vehicle service types become a per-vendor, user-manageable catalogue
-- (owner-requested 2026-09-18): vendors can add their own service types from
-- the "Record Service" dialog and delete ones that were never used.
--
-- 1. The VehicleServiceType enum is replaced by a plain TEXT `key` on
--    VehicleMaintenanceRule / VehicleServiceRecord. Existing values (ENGINE_OIL,
--    ...) are preserved verbatim via the ::text cast, so all history and every
--    rule row is untouched. Existing indexes/uniques on the columns survive the
--    type change.
-- 2. New VehicleServiceTypeDef table = the catalogue. Every existing vendor is
--    seeded with the 19 built-ins (same labels/intervals as the former
--    VEHICLE_SERVICE_TYPE_LABELS / VEHICLE_MAINTENANCE_DEFAULT_INTERVALS
--    constants). Vendors created later are seeded lazily by
--    VehicleServiceTypeService.ensureSeeded.

-- AlterTable
ALTER TABLE "VehicleMaintenanceRule" ALTER COLUMN "serviceType" TYPE TEXT USING "serviceType"::text;

-- AlterTable
ALTER TABLE "VehicleServiceRecord" ALTER COLUMN "serviceType" TYPE TEXT USING "serviceType"::text;

-- DropEnum
DROP TYPE "VehicleServiceType";

-- CreateTable
CREATE TABLE "VehicleServiceTypeDef" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "defaultIntervalKm" INTEGER,
    "defaultIntervalDays" INTEGER,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleServiceTypeDef_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VehicleServiceTypeDef_vendorId_key_key" ON "VehicleServiceTypeDef"("vendorId", "key");

-- AddForeignKey
ALTER TABLE "VehicleServiceTypeDef" ADD CONSTRAINT "VehicleServiceTypeDef_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed the built-in catalogue for every existing vendor.
INSERT INTO "VehicleServiceTypeDef" (
  "id", "vendorId", "key", "label", "defaultIntervalKm", "defaultIntervalDays", "isSystem", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  v."id",
  b."key",
  b."label",
  b."defaultIntervalKm",
  b."defaultIntervalDays",
  b."isSystem",
  now(),
  now()
FROM "Vendor" v
CROSS JOIN (
  VALUES
    ('ENGINE_OIL',         'Engine Oil',                   2500,   180,  false),
    ('OIL_FILTER',         'Oil Filter',                   5000,   180,  false),
    ('AIR_FILTER',         'Air Filter',                   10000,  365,  false),
    ('FUEL_FILTER',        'Fuel Filter',                  10000,  365,  false),
    ('BRAKE_FLUID',        'Brake Fluid',                  20000,  365,  false),
    ('BRAKE_PADS',         'Brake Pads',                   25000,  NULL, false),
    ('COOLANT',            'Coolant',                      50000,  365,  false),
    ('RADIATOR',           'Radiator',                     NULL,   NULL, false),
    ('TRANSMISSION_FLUID', 'Transmission Fluid',           50000,  730,  false),
    ('TYRE_ROTATION',      'Tyre Rotation',                15000,  NULL, false),
    ('BATTERY',            'Battery',                      NULL,   730,  false),
    ('SUSPENSION',         'Suspension',                   50000,  365,  false),
    ('CLUTCH',             'Clutch',                       60000,  NULL, false),
    ('TIMING_BELT',        'Timing Belt',                  100000, 1825, false),
    ('SPARK_PLUGS',        'Spark Plugs',                  40000,  NULL, false),
    ('WHEEL_ALIGNMENT',    'Wheel Alignment & Balancing',  15000,  365,  false),
    ('AC_SERVICE',         'AC Service',                   NULL,   365,  false),
    ('GENERAL_INSPECTION', 'General Safety Inspection',    NULL,   180,  false),
    ('OTHER',              'Other',                        NULL,   NULL, true)
) AS b("key", "label", "defaultIntervalKm", "defaultIntervalDays", "isSystem");
