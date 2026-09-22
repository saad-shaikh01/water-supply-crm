-- Adds ExtraLabour.cnic (owner-approved 2026-09-22). Split into its own
-- migration rather than folded back into 20260922010000_add_extra_labour_tables
-- because that migration was already applied (the ExtraLabour/ExtraLabourType
-- tables exist and are in use) before this column was added to the schema —
-- editing an already-applied migration file never reaches a real database.
ALTER TABLE "ExtraLabour" ADD COLUMN "cnic" TEXT;
