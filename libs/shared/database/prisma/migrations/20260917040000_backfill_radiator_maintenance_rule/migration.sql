-- Backfill: give every vehicle that has already had its maintenance list
-- seeded (see VehicleMaintenanceService.ensureDefaultRules) a RADIATOR rule
-- row too, so the new service type shows up without waiting for a re-seed.
-- Vehicles that have never opened their maintenance list yet will get it
-- automatically via ensureDefaultRules once the RADIATOR type is live.
INSERT INTO "VehicleMaintenanceRule" (
  "id", "vendorId", "vehicleId", "serviceType", "intervalKm", "intervalDays", "isActive", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  v."vendorId",
  v."id",
  'RADIATOR',
  NULL,
  NULL,
  true,
  now(),
  now()
FROM "Vehicle" v
WHERE EXISTS (SELECT 1 FROM "VehicleMaintenanceRule" r WHERE r."vehicleId" = v."id")
  AND NOT EXISTS (
    SELECT 1 FROM "VehicleMaintenanceRule" r2
    WHERE r2."vehicleId" = v."id" AND r2."serviceType" = 'RADIATOR'
  );
