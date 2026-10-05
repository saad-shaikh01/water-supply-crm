-- DailySheet.salesmanId (owner-requested 2026-10-05).
-- The salesman becomes a first-class, always-present column on the sheet: every
-- operational screen shows the salesman, the driver is only shown in fleet flows.
-- Previously the salesman was an optional DailySheetCrew row and the UI faked
-- "same as driver" when it was missing.
--
-- Backfill: salesman = the sheet's existing SALESMAN crew row (earliest if more
-- than one), otherwise the sheet's driver. The SALESMAN crew rows are then removed
-- (DailySheetCrew now holds LOADERs only) so there is a single source of truth.

-- AlterTable (nullable first so existing rows can be backfilled)
ALTER TABLE "DailySheet" ADD COLUMN "salesmanId" TEXT;

-- Backfill 1: existing SALESMAN crew member
UPDATE "DailySheet" ds
SET "salesmanId" = c."userId"
FROM (
  SELECT DISTINCT ON ("dailySheetId") "dailySheetId", "userId"
  FROM "DailySheetCrew"
  WHERE "role" = 'SALESMAN'
  ORDER BY "dailySheetId", "createdAt" ASC
) c
WHERE c."dailySheetId" = ds."id";

-- Backfill 2: no separate salesman -> the driver is the salesman
UPDATE "DailySheet" SET "salesmanId" = "driverId" WHERE "salesmanId" IS NULL;

-- The salesman now lives on the sheet, not in the crew junction
DELETE FROM "DailySheetCrew" WHERE "role" = 'SALESMAN';

-- Enforce
ALTER TABLE "DailySheet" ALTER COLUMN "salesmanId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "DailySheet_salesmanId_date_idx" ON "DailySheet"("salesmanId", "date");

-- AddForeignKey
ALTER TABLE "DailySheet" ADD CONSTRAINT "DailySheet_salesmanId_fkey" FOREIGN KEY ("salesmanId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
