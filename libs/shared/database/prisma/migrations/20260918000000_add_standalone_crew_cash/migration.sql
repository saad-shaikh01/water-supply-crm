-- Standalone Crew Cash (owner-requested 2026-09-18).
--
-- Crew Cash recorded WITHOUT a Daily Sheet — the existing CrewCashDistribution
-- table hard-requires a dailySheetId (it is Daily-Sheet-scoped by design, and
-- only syncs into the Payroll Ledger at sheet close). This adds a sibling,
-- vendor-wide cash tier for the same CrewCashCategory of spend, in the same
-- shape as FuelCardTopUp/OfficeCashRemittance: no PENDING/APPROVED gate of its
-- own, single-step, and it draws down the Office Cash Ledger's available
-- balance the instant it's recorded.
--
-- Because there is no "sheet close" boundary to sync at, the StaffLedgerEntry
-- (a debit against the employee) is created in the SAME transaction as this
-- row and referenced immediately via staffLedgerEntryId — see
-- StandaloneCrewCashService.create.
--
-- Purely additive: one new table + one new enum, no existing table altered.

-- CreateEnum
CREATE TYPE "StandaloneCrewCashStatus" AS ENUM ('ACTIVE', 'VOIDED');

-- CreateTable
CREATE TABLE "StandaloneCrewCashExpense" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "category" "CrewCashCategory" NOT NULL,
    "amount" INTEGER NOT NULL,
    "notes" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "status" "StandaloneCrewCashStatus" NOT NULL DEFAULT 'ACTIVE',
    "staffLedgerEntryId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "voidedById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StandaloneCrewCashExpense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StandaloneCrewCashExpense_staffLedgerEntryId_key" ON "StandaloneCrewCashExpense"("staffLedgerEntryId");

-- CreateIndex
CREATE INDEX "StandaloneCrewCashExpense_vendorId_employeeId_date_idx" ON "StandaloneCrewCashExpense"("vendorId", "employeeId", "date");

-- CreateIndex
CREATE INDEX "StandaloneCrewCashExpense_vendorId_status_idx" ON "StandaloneCrewCashExpense"("vendorId", "status");

-- AddForeignKey
ALTER TABLE "StandaloneCrewCashExpense" ADD CONSTRAINT "StandaloneCrewCashExpense_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StandaloneCrewCashExpense" ADD CONSTRAINT "StandaloneCrewCashExpense_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StandaloneCrewCashExpense" ADD CONSTRAINT "StandaloneCrewCashExpense_staffLedgerEntryId_fkey" FOREIGN KEY ("staffLedgerEntryId") REFERENCES "StaffLedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StandaloneCrewCashExpense" ADD CONSTRAINT "StandaloneCrewCashExpense_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StandaloneCrewCashExpense" ADD CONSTRAINT "StandaloneCrewCashExpense_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
