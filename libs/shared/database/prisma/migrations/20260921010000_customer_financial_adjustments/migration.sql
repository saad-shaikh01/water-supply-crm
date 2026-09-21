-- Customer Financial Adjustments — Phase 1 foundation (owner-approved 2026-09-21).
--
-- Manual, non-delivery money events on a customer's account (service fees,
-- penalties, discounts/credits, transfers, write-offs, corrections). A POSTED
-- adjustment produces exactly one ledger Transaction (Transaction.adjustmentId)
-- and moves Customer.financialBalance in the same DB transaction; a mistake is
-- voided by a REVERSAL row, never edited or deleted (all FKs are RESTRICT).
--
-- PURELY ADDITIVE: 5 enums, 2 tables, 1 nullable column on "Transaction". No
-- existing row is read, rewritten or backfilled; nothing behaves differently
-- until the posting service ships (Phase 2). Body below is the exact output of
--   prisma migrate diff --from-schema-datamodel <HEAD schema> --to-schema-datamodel <new schema> --script
-- plus the one hand-written CHECK constraint at the end.

-- CreateEnum
CREATE TYPE "AdjustmentKind" AS ENUM ('SERVICE_FEE', 'PENALTY', 'OTHER_CHARGE', 'DISCOUNT', 'GOODWILL_CREDIT', 'OTHER_CREDIT', 'TRANSFER_OUT', 'TRANSFER_IN', 'WRITE_OFF', 'CORRECTION', 'REVERSAL');

-- CreateEnum
CREATE TYPE "AdjustmentDirection" AS ENUM ('CHARGE', 'CREDIT');

-- CreateEnum
CREATE TYPE "AdjustmentStatus" AS ENUM ('POSTED', 'VOIDED');

-- CreateEnum
CREATE TYPE "AdjustmentVisibility" AS ENUM ('ITEMIZED', 'SUMMARIZED');

-- CreateEnum
CREATE TYPE "AdjustmentGroupType" AS ENUM ('TRANSFER');

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "adjustmentId" TEXT;

-- CreateTable
CREATE TABLE "CustomerFinancialAdjustment" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "kind" "AdjustmentKind" NOT NULL,
    "direction" "AdjustmentDirection" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "internalNote" TEXT,
    "referenceNo" TEXT,
    "customerVisibility" "AdjustmentVisibility" NOT NULL DEFAULT 'ITEMIZED',
    "status" "AdjustmentStatus" NOT NULL DEFAULT 'POSTED',
    "createdById" TEXT NOT NULL,
    "voidedById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "reversalOfId" TEXT,
    "groupId" TEXT,
    "counterpartyCustomerId" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerFinancialAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerFinancialAdjustmentGroup" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "type" "AdjustmentGroupType" NOT NULL,
    "status" "AdjustmentStatus" NOT NULL DEFAULT 'POSTED',
    "createdById" TEXT NOT NULL,
    "voidedById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerFinancialAdjustmentGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerFinancialAdjustment_reversalOfId_key" ON "CustomerFinancialAdjustment"("reversalOfId");

-- CreateIndex
CREATE INDEX "CustomerFinancialAdjustment_vendorId_customerId_effectiveDa_idx" ON "CustomerFinancialAdjustment"("vendorId", "customerId", "effectiveDate");

-- CreateIndex
CREATE INDEX "CustomerFinancialAdjustment_vendorId_status_idx" ON "CustomerFinancialAdjustment"("vendorId", "status");

-- CreateIndex
CREATE INDEX "CustomerFinancialAdjustment_groupId_idx" ON "CustomerFinancialAdjustment"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerFinancialAdjustment_vendorId_idempotencyKey_key" ON "CustomerFinancialAdjustment"("vendorId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "CustomerFinancialAdjustmentGroup_vendorId_status_idx" ON "CustomerFinancialAdjustmentGroup"("vendorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerFinancialAdjustmentGroup_vendorId_idempotencyKey_key" ON "CustomerFinancialAdjustmentGroup"("vendorId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_adjustmentId_key" ON "Transaction"("adjustmentId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "CustomerFinancialAdjustment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerFinancialAdjustment" ADD CONSTRAINT "CustomerFinancialAdjustment_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerFinancialAdjustment" ADD CONSTRAINT "CustomerFinancialAdjustment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerFinancialAdjustment" ADD CONSTRAINT "CustomerFinancialAdjustment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerFinancialAdjustment" ADD CONSTRAINT "CustomerFinancialAdjustment_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerFinancialAdjustment" ADD CONSTRAINT "CustomerFinancialAdjustment_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "CustomerFinancialAdjustment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerFinancialAdjustment" ADD CONSTRAINT "CustomerFinancialAdjustment_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CustomerFinancialAdjustmentGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerFinancialAdjustment" ADD CONSTRAINT "CustomerFinancialAdjustment_counterpartyCustomerId_fkey" FOREIGN KEY ("counterpartyCustomerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerFinancialAdjustmentGroup" ADD CONSTRAINT "CustomerFinancialAdjustmentGroup_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerFinancialAdjustmentGroup" ADD CONSTRAINT "CustomerFinancialAdjustmentGroup_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerFinancialAdjustmentGroup" ADD CONSTRAINT "CustomerFinancialAdjustmentGroup_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Money is always stored POSITIVE; the ledger sign comes from "direction".
-- Prisma cannot express CHECK constraints (it neither models nor diffs them),
-- so this is hand-written and is safe alongside `prisma migrate` drift checks.
ALTER TABLE "CustomerFinancialAdjustment"
  ADD CONSTRAINT "CustomerFinancialAdjustment_amount_positive" CHECK ("amount" > 0);
