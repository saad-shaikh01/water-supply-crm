-- Data-only migration: lower ENGINE_OIL service interval from 5,000 km to
-- 2,500 km fleet-wide. Only touches rows still at the old default (5000) so
-- any vehicle that already has a manually customized interval is left alone.
UPDATE "VehicleMaintenanceRule"
SET "intervalKm" = 2500
WHERE "serviceType" = 'ENGINE_OIL' AND "intervalKm" = 5000;
