-- Adds RADIATOR as a vehicle service type so it can be logged as its own
-- maintenance/expense line item instead of being folded into COOLANT/OTHER.
ALTER TYPE "VehicleServiceType" ADD VALUE 'RADIATOR';
