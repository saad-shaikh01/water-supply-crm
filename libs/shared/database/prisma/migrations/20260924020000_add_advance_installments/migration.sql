-- Advance Installments (owner request 2026-09-24) — turns a staff cash advance into
-- a real installment loan: one full disbursement, recovered over however many
-- payroll periods it actually takes, with skip-and-roll-forward + per-period
-- amount overrides. See docs/features/staff-payroll-financial-management.md §11.
--
-- Purely additive: two new StaffLedgerCategory enum values, two new enums, two new
-- tables. No existing column altered, no data backfill. The plain ADVANCE ledger
-- category and its existing behavior are completely untouched — this only adds a
-- second path (ADVANCE_DISBURSEMENT + ADVANCE_RECOVERY) for advances that are
-- meant to be recovered on a schedule rather than netted in full immediately.

-- AlterEnum
ALTER TYPE "StaffLedgerCategory" ADD VALUE 'ADVANCE_DISBURSEMENT';
ALTER TYPE "StaffLedgerCategory" ADD VALUE 'ADVANCE_RECOVERY';

-- CreateEnum
CREATE TYPE "AdvancePlanStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AdvanceInstallmentStatus" AS ENUM ('PENDING', 'COLLECTED', 'SKIPPED');

-- CreateTable
CREATE TABLE "StaffAdvancePlan" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "principalAmount" INTEGER NOT NULL,
    "defaultInstallmentAmount" INTEGER NOT NULL,
    "disbursedAt" TIMESTAMP(3) NOT NULL,
    "disbursementLedgerEntryId" TEXT NOT NULL,
    "status" "AdvancePlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffAdvancePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffAdvanceInstallment" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "scheduledAmount" INTEGER NOT NULL,
    "actualAmount" INTEGER,
    "status" "AdvanceInstallmentStatus" NOT NULL DEFAULT 'PENDING',
    "ledgerEntryId" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffAdvanceInstallment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffAdvancePlan_disbursementLedgerEntryId_key" ON "StaffAdvancePlan"("disbursementLedgerEntryId");

-- CreateIndex
CREATE INDEX "StaffAdvancePlan_vendorId_userId_status_idx" ON "StaffAdvancePlan"("vendorId", "userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StaffAdvanceInstallment_ledgerEntryId_key" ON "StaffAdvanceInstallment"("ledgerEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffAdvanceInstallment_planId_periodId_key" ON "StaffAdvanceInstallment"("planId", "periodId");

-- CreateIndex
CREATE INDEX "StaffAdvanceInstallment_vendorId_periodId_idx" ON "StaffAdvanceInstallment"("vendorId", "periodId");

-- AddForeignKey
ALTER TABLE "StaffAdvancePlan" ADD CONSTRAINT "StaffAdvancePlan_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAdvancePlan" ADD CONSTRAINT "StaffAdvancePlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAdvancePlan" ADD CONSTRAINT "StaffAdvancePlan_disbursementLedgerEntryId_fkey" FOREIGN KEY ("disbursementLedgerEntryId") REFERENCES "StaffLedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAdvancePlan" ADD CONSTRAINT "StaffAdvancePlan_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAdvanceInstallment" ADD CONSTRAINT "StaffAdvanceInstallment_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAdvanceInstallment" ADD CONSTRAINT "StaffAdvanceInstallment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "StaffAdvancePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAdvanceInstallment" ADD CONSTRAINT "StaffAdvanceInstallment_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "PayrollPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAdvanceInstallment" ADD CONSTRAINT "StaffAdvanceInstallment_ledgerEntryId_fkey" FOREIGN KEY ("ledgerEntryId") REFERENCES "StaffLedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAdvanceInstallment" ADD CONSTRAINT "StaffAdvanceInstallment_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
