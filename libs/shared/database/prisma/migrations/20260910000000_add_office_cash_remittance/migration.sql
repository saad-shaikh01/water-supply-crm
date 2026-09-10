-- Office Cash Remittance (owner-requested 2026-09-10).
--
-- Adds the third cash-custody tier the Van Cash Ledger was missing:
--   Van (driver) -> Office cash box -> Owner / CEO / Bank
-- The driver -> office hop is VanCashHandover; this is the office -> owner hop.
--
-- Vendor-wide (no vanId): once van handovers are APPROVED the office cash pool
-- is fungible. Same lifecycle as VanCashHandover — PENDING -> APPROVED counts
-- toward the running balance; a post-approval fix is a NEW row pointing back via
-- correctsEntryId carrying the DELTA (not the new total); nothing is mutated in
-- place once APPROVED; a void is a status flip to VOIDED, never a DELETE.
-- Optimistic concurrency via "version".
--
-- Purely additive: one new table + two new enums, no existing table altered.

-- CreateEnum
CREATE TYPE "OfficeCashRemittanceStatus" AS ENUM ('PENDING', 'APPROVED', 'VOIDED');

-- CreateEnum
CREATE TYPE "OfficeCashRemittanceDestination" AS ENUM ('OWNER', 'CEO', 'BANK', 'OTHER');

-- CreateTable
CREATE TABLE "OfficeCashRemittance" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "submittedAmount" DOUBLE PRECISION NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "destination" "OfficeCashRemittanceDestination" NOT NULL DEFAULT 'OWNER',
    "destinationName" TEXT,
    "reference" TEXT,
    "attachmentKey" TEXT,
    "note" TEXT,
    "status" "OfficeCashRemittanceStatus" NOT NULL DEFAULT 'PENDING',
    "submittedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedAmount" DOUBLE PRECISION,
    "adjustmentReason" TEXT,
    "negativeOverrideReason" TEXT,
    "voidedById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "correctsEntryId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfficeCashRemittance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OfficeCashRemittance_vendorId_date_idx" ON "OfficeCashRemittance"("vendorId", "date");

-- CreateIndex
CREATE INDEX "OfficeCashRemittance_vendorId_status_idx" ON "OfficeCashRemittance"("vendorId", "status");

-- CreateIndex
CREATE INDEX "OfficeCashRemittance_correctsEntryId_idx" ON "OfficeCashRemittance"("correctsEntryId");

-- AddForeignKey
ALTER TABLE "OfficeCashRemittance" ADD CONSTRAINT "OfficeCashRemittance_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficeCashRemittance" ADD CONSTRAINT "OfficeCashRemittance_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficeCashRemittance" ADD CONSTRAINT "OfficeCashRemittance_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficeCashRemittance" ADD CONSTRAINT "OfficeCashRemittance_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficeCashRemittance" ADD CONSTRAINT "OfficeCashRemittance_correctsEntryId_fkey" FOREIGN KEY ("correctsEntryId") REFERENCES "OfficeCashRemittance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
