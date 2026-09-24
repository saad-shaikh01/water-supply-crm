-- Advance Plan Write-off / Forgive (owner-requested 2026-09-25) — the company
-- can forgive whatever remains uncollected on an advance (e.g. employee
-- resigned, balance is unrecoverable). Only an ACTIVE plan with remaining
-- balance > 0 is write-off-eligible; any still-PENDING installment for it is
-- auto-skipped in the same transaction. Purely additive: four new nullable
-- columns + one new FK. No existing column altered, no data backfill.

-- AlterTable
ALTER TABLE "StaffAdvancePlan" ADD COLUMN "cancelledAt" TIMESTAMP(3),
ADD COLUMN "cancelledById" TEXT,
ADD COLUMN "cancelReason" TEXT;

-- AddForeignKey
ALTER TABLE "StaffAdvancePlan" ADD CONSTRAINT "StaffAdvancePlan_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
