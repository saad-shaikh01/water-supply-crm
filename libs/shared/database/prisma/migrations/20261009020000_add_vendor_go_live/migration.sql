-- Vendor onboarding "go live" marker (additive; see docs/features/multi-vendor-branding-and-whatsapp.md §7)
ALTER TABLE "Vendor" ADD COLUMN "goLiveAt" TIMESTAMP(3);

-- Continuity: every vendor that already exists is live (Blue Ice and any other running vendor keep
-- working exactly as before). Only vendors created from now on start in the "not live yet" state.
UPDATE "Vendor" SET "goLiveAt" = CURRENT_TIMESTAMP;
