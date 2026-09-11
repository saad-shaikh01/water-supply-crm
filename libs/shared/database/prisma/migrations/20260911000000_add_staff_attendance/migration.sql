-- Staff Attendance & Wage Types — Phase 1
-- (docs/features/staff-attendance-and-wage-types.md).
--
-- One operational row per employee per calendar day (PRESENT / ABSENT /
-- HALF_DAY / LEAVE / WEEKLY_OFF), auto-captured when a DailySheet's crew is
-- confirmed and settable manually. Attendance is NOT a financial record: the
-- money consequence of an unpaid absence lives entirely in a linked
-- LEAVE_UNPAID StaffLedgerEntry, referenced (one-directionally, idempotently)
-- via "leaveLedgerEntryId" — so this table has no audit-log sibling of its own.
--
-- Purely additive: one new table + two new enums, no existing table altered, no
-- data backfill. Safe to run in one transaction (no enum-value reuse).

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'HALF_DAY', 'LEAVE', 'WEEKLY_OFF');

-- CreateEnum
CREATE TYPE "AttendanceSource" AS ENUM ('CREW_CONFIRM', 'MANUAL');

-- CreateTable
CREATE TABLE "StaffAttendance" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'PRESENT',
    "source" "AttendanceSource" NOT NULL DEFAULT 'CREW_CONFIRM',
    "dailySheetId" TEXT,
    "note" TEXT,
    "markedById" TEXT NOT NULL,
    "leaveLedgerEntryId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffAttendance_leaveLedgerEntryId_key" ON "StaffAttendance"("leaveLedgerEntryId");

-- CreateIndex
CREATE INDEX "StaffAttendance_vendorId_date_idx" ON "StaffAttendance"("vendorId", "date");

-- CreateIndex
CREATE INDEX "StaffAttendance_dailySheetId_idx" ON "StaffAttendance"("dailySheetId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffAttendance_userId_date_key" ON "StaffAttendance"("userId", "date");

-- AddForeignKey
ALTER TABLE "StaffAttendance" ADD CONSTRAINT "StaffAttendance_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAttendance" ADD CONSTRAINT "StaffAttendance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAttendance" ADD CONSTRAINT "StaffAttendance_dailySheetId_fkey" FOREIGN KEY ("dailySheetId") REFERENCES "DailySheet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAttendance" ADD CONSTRAINT "StaffAttendance_markedById_fkey" FOREIGN KEY ("markedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAttendance" ADD CONSTRAINT "StaffAttendance_leaveLedgerEntryId_fkey" FOREIGN KEY ("leaveLedgerEntryId") REFERENCES "StaffLedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
