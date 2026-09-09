-- Additive only — no existing rows/values touched. Adds one new selectable
-- VEHICLE-domain expense category (owner request 2026-09-09) for renting an
-- additional truck/vehicle — distinct from the existing OFFICE-domain RENT
-- category (premises/warehouse rent).

-- AlterEnum
ALTER TYPE "ExpenseCategory" ADD VALUE 'VEHICLE_RENT';
