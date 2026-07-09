-- Enforce at the DB level that a van has at most one DailySheet per calendar
-- date. Previously this was only a check-then-create in application code
-- (daily-sheet.processor.ts), which is safe for the single-threaded nightly
-- cron but not for concurrent, user-triggered sheet auto-creation (the
-- customer-move feature can create a destination sheet on demand). The
-- service layer catches the resulting unique-violation (Prisma P2002) and
-- falls back to re-fetching the sheet the other request just created.
--
-- IMPORTANT — run this check BEFORE applying this migration in any
-- environment with existing data. If it returns any rows, this migration
-- will fail (or must not be applied) until those duplicates are resolved:
--
--   SELECT "vendorId", "vanId", "date", COUNT(*)
--   FROM "DailySheet"
--   GROUP BY "vendorId", "vanId", "date"
--   HAVING COUNT(*) > 1;

CREATE UNIQUE INDEX "DailySheet_vendorId_vanId_date_key" ON "DailySheet"("vendorId", "vanId", "date");
