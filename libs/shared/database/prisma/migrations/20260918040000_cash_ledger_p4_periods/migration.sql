-- Cash Ledger redesign — Phase P4 (owner-approved 2026-09-18): accounting periods.
--
-- Purely additive: one new enum + table, one nullable column. No data rewritten.
--
-- 1. CashLedgerPeriod — calendar months in Asia/Karachi ("YYYY-MM"). A row only
--    exists once a period has been CLOSED (no row = OPEN). The ledger balance
--    itself stays live/single-truth; closingBalance + snapshotJson are just the
--    "as closed" snapshot behind the drift chip ("As closed ₨X · Now ₨Y").
-- 2. VanCashHandover.relatesToDate — the redirect rule: a system / approval-time
--    posting whose business date falls in a CLOSED period lands in the CURRENT
--    period (date = today) and keeps the original business date here.

-- CreateEnum
CREATE TYPE "CashLedgerPeriodStatus" AS ENUM ('OPEN', 'CLOSED');

-- AlterTable
ALTER TABLE "VanCashHandover" ADD COLUMN "relatesToDate" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CashLedgerPeriod" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "periodLabel" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "CashLedgerPeriodStatus" NOT NULL DEFAULT 'CLOSED',
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closeNote" TEXT,
    "closingBalance" DOUBLE PRECISION,
    "snapshotJson" JSONB,
    "reopenedAt" TIMESTAMP(3),
    "reopenedById" TEXT,
    "reopenReason" TEXT,
    "reopenCount" INTEGER NOT NULL DEFAULT 0,
    "overrideCount" INTEGER NOT NULL DEFAULT 0,
    "lastOverrideAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashLedgerPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CashLedgerPeriod_vendorId_periodLabel_key" ON "CashLedgerPeriod"("vendorId", "periodLabel");

-- CreateIndex
CREATE INDEX "CashLedgerPeriod_vendorId_status_idx" ON "CashLedgerPeriod"("vendorId", "status");

-- AddForeignKey
ALTER TABLE "CashLedgerPeriod" ADD CONSTRAINT "CashLedgerPeriod_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashLedgerPeriod" ADD CONSTRAINT "CashLedgerPeriod_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashLedgerPeriod" ADD CONSTRAINT "CashLedgerPeriod_reopenedById_fkey" FOREIGN KEY ("reopenedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
