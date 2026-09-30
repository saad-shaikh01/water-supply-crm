-- Customer Deposits (owner-requested 2026-09-29): an optional, per-customer
-- refundable security deposit — CASH (a Rs. amount held) or BOTTLE (bottles
-- the CUSTOMER owns, handed to the company as security, count-only, no cash
-- value, per-product — the opposite direction from BottleWallet, the
-- company's own circulating stock). Deliberately kept separate from CustomerFinancialAdjustment/
-- Customer.financialBalance/BottleWallet: a deposit is a held liability, not
-- a charge/credit or a normal circulating bottle. Gated vendor-wide by the
-- new Vendor.depositsEnabled toggle, false by default, so vendors who never
-- collect a deposit see no trace of this feature.
--
-- Mirrors CustomerFinancialAdjustment's document+ledger pattern: a mistake is
-- voided by a REVERSAL entry, never edited or deleted (all FKs on the entry
-- table are RESTRICT). DailySheetItem gets 4 new columns so a driver can
-- collect/return a deposit during a delivery, fully separate from the
-- existing cashCollected/bottleBalanceAfter math on that same row.
--
-- PURELY ADDITIVE: 4 enums, 2 tables, 1 new column on "Vendor", 4 new columns
-- on "DailySheetItem". No existing row is read, rewritten or backfilled;
-- nothing behaves differently until the posting service ships (Phase 2).

-- CreateEnum
CREATE TYPE "DepositType" AS ENUM ('CASH', 'BOTTLE');

-- CreateEnum
CREATE TYPE "DepositEntryDirection" AS ENUM ('COLLECT', 'REFUND', 'WRITE_OFF');

-- CreateEnum
CREATE TYPE "DepositEntrySource" AS ENUM ('OFFICE', 'DELIVERY');

-- CreateEnum
CREATE TYPE "DepositEntryStatus" AS ENUM ('POSTED', 'VOIDED');

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "depositsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "DailySheetItem" ADD COLUMN     "depositCashCollected" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "depositBottlesCollected" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "depositBottlesReturned" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "depositProductId" TEXT;

-- CreateTable
CREATE TABLE "CustomerDeposit" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" "DepositType" NOT NULL,
    "productId" TEXT,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerDeposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerDepositEntry" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "depositId" TEXT NOT NULL,
    "direction" "DepositEntryDirection" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "source" "DepositEntrySource" NOT NULL,
    "status" "DepositEntryStatus" NOT NULL DEFAULT 'POSTED',
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "referenceNo" TEXT,
    "dailySheetItemId" TEXT,
    "createdById" TEXT NOT NULL,
    "voidedById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "reversalOfId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerDepositEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerDeposit_vendorId_idx" ON "CustomerDeposit"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerDeposit_customerId_type_productId_key" ON "CustomerDeposit"("customerId", "type", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerDepositEntry_reversalOfId_key" ON "CustomerDepositEntry"("reversalOfId");

-- CreateIndex
CREATE INDEX "CustomerDepositEntry_vendorId_depositId_idx" ON "CustomerDepositEntry"("vendorId", "depositId");

-- CreateIndex
CREATE INDEX "CustomerDepositEntry_dailySheetItemId_idx" ON "CustomerDepositEntry"("dailySheetItemId");

-- AddForeignKey
ALTER TABLE "DailySheetItem" ADD CONSTRAINT "DailySheetItem_depositProductId_fkey" FOREIGN KEY ("depositProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerDeposit" ADD CONSTRAINT "CustomerDeposit_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerDeposit" ADD CONSTRAINT "CustomerDeposit_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerDeposit" ADD CONSTRAINT "CustomerDeposit_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerDepositEntry" ADD CONSTRAINT "CustomerDepositEntry_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerDepositEntry" ADD CONSTRAINT "CustomerDepositEntry_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "CustomerDeposit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerDepositEntry" ADD CONSTRAINT "CustomerDepositEntry_dailySheetItemId_fkey" FOREIGN KEY ("dailySheetItemId") REFERENCES "DailySheetItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerDepositEntry" ADD CONSTRAINT "CustomerDepositEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerDepositEntry" ADD CONSTRAINT "CustomerDepositEntry_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerDepositEntry" ADD CONSTRAINT "CustomerDepositEntry_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "CustomerDepositEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Money/bottle-count is always stored POSITIVE; the ledger sign comes from
-- "direction". Prisma cannot express CHECK constraints (it neither models nor
-- diffs them), so this is hand-written and is safe alongside `prisma migrate`
-- drift checks (mirrors CustomerFinancialAdjustment_amount_positive).
ALTER TABLE "CustomerDepositEntry"
  ADD CONSTRAINT "CustomerDepositEntry_amount_positive" CHECK ("amount" > 0);
