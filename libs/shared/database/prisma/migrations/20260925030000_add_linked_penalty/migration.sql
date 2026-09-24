-- Linked Penalty (owner-approved 2026-09-25) — wires a staff PENALTY/DEDUCTION
-- ledger entry to the CustomerFinancialAdjustment credit it caused, for the
-- "driver didn't record a customer's cash payment" flow: the customer is
-- credited the missed amount while the same amount is docked from the
-- staff member's pay, atomically, via LinkedPenaltyService. Purely additive:
-- one new enum value + two new nullable columns + one FK + one unique
-- constraint + one index. No existing column altered, no data backfill.

-- AlterEnum
ALTER TYPE "AdjustmentKind" ADD VALUE 'STAFF_FAULT_CREDIT';

-- AlterTable
ALTER TABLE "StaffLedgerEntry" ADD COLUMN "linkedCustomerId" TEXT,
ADD COLUMN "causedCustomerAdjustmentId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "StaffLedgerEntry_causedCustomerAdjustmentId_key" ON "StaffLedgerEntry"("causedCustomerAdjustmentId");

-- CreateIndex
CREATE INDEX "StaffLedgerEntry_linkedCustomerId_idx" ON "StaffLedgerEntry"("linkedCustomerId");

-- AddForeignKey
ALTER TABLE "StaffLedgerEntry" ADD CONSTRAINT "StaffLedgerEntry_linkedCustomerId_fkey" FOREIGN KEY ("linkedCustomerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffLedgerEntry" ADD CONSTRAINT "StaffLedgerEntry_causedCustomerAdjustmentId_fkey" FOREIGN KEY ("causedCustomerAdjustmentId") REFERENCES "CustomerFinancialAdjustment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
