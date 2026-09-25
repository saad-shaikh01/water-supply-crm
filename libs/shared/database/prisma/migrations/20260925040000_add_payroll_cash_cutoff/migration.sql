-- Dual-cutoff payroll flexibility (owner-requested 2026-09-25) — lets a
-- vendor run the attendance/wage cycle on one cutoff day while advances,
-- crew cash, or any other chosen ledger categories are cut off on a
-- SEPARATE day (e.g. a vendor whose attendance period is calendar-month but
-- whose advance/crew-cash deductions are collected up to the 10th, ahead of
-- a 10th-of-next-month salary release). Purely additive, both nullable/
-- defaulted — cashCutoffDay defaults to NULL (disabled) and
-- cashWindowCategories defaults to an empty array, so every existing vendor
-- keeps computing payroll on the single `cutoffDay` window exactly as before.

-- AlterTable
ALTER TABLE "PayrollVendorConfig" ADD COLUMN "cashCutoffDay" INTEGER,
ADD COLUMN "cashWindowCategories" "StaffLedgerCategory"[] NOT NULL DEFAULT ARRAY[]::"StaffLedgerCategory"[];
