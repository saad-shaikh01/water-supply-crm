-- Attendance Categories — extension to Staff Attendance
-- (owner request 2026-09-24): a per-vendor, admin-managed reason catalogue for
-- a manual PRESENT marking that isn't regular crew duty (e.g. an employee who
-- wasn't on their route that day but was doing some other office task).
-- Vendors create their own categories; there are no built-ins.
--
-- Purely additive: one new table + one new nullable FK column on the existing
-- StaffAttendance table. No data backfill, no existing column altered.

-- CreateTable
CREATE TABLE "AttendanceCategory" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceCategory_vendorId_idx" ON "AttendanceCategory"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceCategory_vendorId_name_key" ON "AttendanceCategory"("vendorId", "name");

-- AddForeignKey
ALTER TABLE "AttendanceCategory" ADD CONSTRAINT "AttendanceCategory_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "StaffAttendance" ADD COLUMN "categoryId" TEXT;

-- AddForeignKey
ALTER TABLE "StaffAttendance" ADD CONSTRAINT "StaffAttendance_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "AttendanceCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
