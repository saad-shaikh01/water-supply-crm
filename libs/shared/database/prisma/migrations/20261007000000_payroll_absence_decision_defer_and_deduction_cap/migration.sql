-- Payroll: absence paid/waived decision, "deduct next month" attribution date, max-deduction ceiling.
-- All additive + nullable/defaulted: every existing row keeps its current behaviour.

-- Vendor-wide optional deduction ceiling (percent of base salary). NULL = off.
ALTER TABLE "PayrollVendorConfig" ADD COLUMN "maxDeductionPercent" INTEGER;

-- Ceiling bookkeeping on each payroll entry. 0 for every existing entry.
ALTER TABLE "PayrollEntry" ADD COLUMN "deferredIn" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PayrollEntry" ADD COLUMN "deferredOut" INTEGER NOT NULL DEFAULT 0;

-- Explicit "paid / waived" decision for an ABSENT / HALF_DAY attendance day.
ALTER TABLE "StaffAttendance" ADD COLUMN "deductionWaivedAt" TIMESTAMP(3);
ALTER TABLE "StaffAttendance" ADD COLUMN "deductionWaivedById" TEXT;
ALTER TABLE "StaffAttendance" ADD COLUMN "deductionWaivedReason" TEXT;
ALTER TABLE "StaffAttendance" ADD CONSTRAINT "StaffAttendance_deductionWaivedById_fkey" FOREIGN KEY ("deductionWaivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Payroll-only attribution date for a deferred ledger entry (effectiveDate, and therefore the Cash Ledger, is untouched).
ALTER TABLE "StaffLedgerEntry" ADD COLUMN "payrollAttributionDate" TIMESTAMP(3);
