-- Salesman is the source of truth for every sheet action; the driver only
-- matters for fleet flows. Re-point the five non-fleet "driver" columns at the
-- salesman. Renames (not drop/add) so existing rows, FKs and indexes survive.

-- DamageCase: column is the REPORTING field-staff user (already shown as "Salesman").
ALTER TABLE "DamageCase" RENAME COLUMN "driverId" TO "salesmanId";
ALTER TABLE "DamageCase" RENAME CONSTRAINT "DamageCase_driverId_fkey" TO "DamageCase_salesmanId_fkey";
ALTER INDEX "DamageCase_driverId_idx" RENAME TO "DamageCase_salesmanId_idx";

-- SheetDiscrepancyCase
ALTER TABLE "SheetDiscrepancyCase" RENAME COLUMN "driverId" TO "salesmanId";
ALTER TABLE "SheetDiscrepancyCase" RENAME CONSTRAINT "SheetDiscrepancyCase_driverId_fkey" TO "SheetDiscrepancyCase_salesmanId_fkey";
ALTER INDEX "SheetDiscrepancyCase_driverId_idx" RENAME TO "SheetDiscrepancyCase_salesmanId_idx";

-- Conversation (denormalized from the sheet)
ALTER TABLE "Conversation" RENAME COLUMN "driverId" TO "salesmanId";
ALTER TABLE "Conversation" RENAME CONSTRAINT "Conversation_driverId_fkey" TO "Conversation_salesmanId_fkey";
ALTER INDEX "Conversation_driverId_lastMessageAt_idx" RENAME TO "Conversation_salesmanId_lastMessageAt_idx";

-- Plain scalar columns (no FK)
ALTER TABLE "DeliveryIssue" RENAME COLUMN "assignedDriverId" TO "assignedSalesmanId";
ALTER TABLE "CustomerOrder" RENAME COLUMN "dispatchDriverId" TO "dispatchSalesmanId";

-- Backfill: sheet-derived columns held the sheet's DRIVER; point them at the sheet's salesman.
UPDATE "SheetDiscrepancyCase" c
   SET "salesmanId" = s."salesmanId"
  FROM "DailySheet" s
 WHERE s."id" = c."dailySheetId" AND s."salesmanId" IS NOT NULL;

UPDATE "Conversation" c
   SET "salesmanId" = s."salesmanId"
  FROM "DailySheet" s
 WHERE s."id" = c."dailySheetId" AND s."salesmanId" IS NOT NULL;
