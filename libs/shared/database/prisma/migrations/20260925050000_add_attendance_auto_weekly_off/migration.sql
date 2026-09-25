-- Sundays are auto-captured as WEEKLY_OFF by StaffAttendanceService.backfillForPeriod
-- (no DailySheet exists on a day with no route, so CREW_CONFIRM never fires for it,
-- and it's not a human decision either, so MANUAL doesn't fit).
ALTER TYPE "AttendanceSource" ADD VALUE 'AUTO_WEEKLY_OFF';
