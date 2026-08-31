-- Route-timeline anchor for the delivery queue. Purely additive, production-safe.
--
-- "deliveredAt" is only set for successful drops (COMPLETED / EMPTY_ONLY), so a
-- failed visit (NOT_AVAILABLE / RESCHEDULED) carried no timestamp and sorted to
-- the bottom of the time-ordered queue alongside stops that were never visited.
-- "recordedAt" is stamped on the FIRST transition off PENDING for ANY terminal
-- status and never rewritten, so every recorded stop has a point on the route
-- timeline. Sort key everywhere becomes COALESCE("deliveredAt", "recordedAt").

-- AlterTable
ALTER TABLE "DailySheetItem" ADD COLUMN "recordedAt" TIMESTAMP(3);

-- Backfill every already-recorded row: successful drops use their real
-- "deliveredAt"; failed / rescheduled rows fall back to "updatedAt", the closest
-- available proxy for when the driver recorded that outcome. Rows still PENDING
-- stay NULL (nothing has been recorded yet).
UPDATE "DailySheetItem"
SET "recordedAt" = COALESCE("deliveredAt", "updatedAt")
WHERE "status" <> 'PENDING';

-- CreateIndex
CREATE INDEX "DailySheetItem_dailySheetId_recordedAt_idx" ON "DailySheetItem"("dailySheetId", "recordedAt");
