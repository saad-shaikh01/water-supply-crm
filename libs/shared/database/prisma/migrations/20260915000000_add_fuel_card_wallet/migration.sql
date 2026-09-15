-- Fuel Card Wallet (owner-requested 2026-09-15).
--
-- Problem: fuel card top-ups (office cash -> fuel card) were being recorded as
-- a generic Expense, AND the fuel actually filled into vehicles from that card
-- was already generating its own FUEL_EXPENSE via FuelLog -- the same rupee
-- was being counted as a company cost twice.
--
-- Fix: a top-up is a transfer between two custodial cash pools (Office Cash ->
-- Fuel Card balance), not an Expense. It reduces the Office Cash Ledger's
-- available balance (same tier as OfficeCashRemittance) but is never an
-- Expense row. The real Expense (FUEL_EXPENSE) still, and only, comes from
-- FuelLog at the moment fuel is actually put in a vehicle.
--
-- Multi-vendor, multi-card: each vendor may register any number of FuelCard
-- rows. Single-step top-up entry (no PENDING/APPROVED gate) with a full,
-- append-only audit trail: nothing is ever mutated or deleted -- a mistake is
-- voided (status -> VOIDED, reason required) and a fresh correct entry
-- recorded, so the complete history stays reconstructable.
--
-- Purely additive: two new tables, one new enum, two new nullable FK columns
-- on existing tables. No existing table is altered destructively.

-- CreateEnum
CREATE TYPE "FuelCardTopUpStatus" AS ENUM ('ACTIVE', 'VOIDED');

-- CreateTable
CREATE TABLE "FuelCard" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cardNumber" TEXT,
    "issuer" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FuelCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FuelCardTopUp" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "fuelCardId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "attachmentKey" TEXT,
    "note" TEXT,
    "status" "FuelCardTopUpStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "voidedById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FuelCardTopUp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FuelCard_vendorId_isActive_idx" ON "FuelCard"("vendorId", "isActive");

-- CreateIndex
CREATE INDEX "FuelCardTopUp_vendorId_fuelCardId_date_idx" ON "FuelCardTopUp"("vendorId", "fuelCardId", "date");

-- CreateIndex
CREATE INDEX "FuelCardTopUp_vendorId_status_idx" ON "FuelCardTopUp"("vendorId", "status");

-- AddForeignKey
ALTER TABLE "FuelCard" ADD CONSTRAINT "FuelCard_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelCard" ADD CONSTRAINT "FuelCard_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelCardTopUp" ADD CONSTRAINT "FuelCardTopUp_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelCardTopUp" ADD CONSTRAINT "FuelCardTopUp_fuelCardId_fkey" FOREIGN KEY ("fuelCardId") REFERENCES "FuelCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelCardTopUp" ADD CONSTRAINT "FuelCardTopUp_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelCardTopUp" ADD CONSTRAINT "FuelCardTopUp_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: FuelLog gains an optional link to the card that paid for the fill
ALTER TABLE "FuelLog" ADD COLUMN "fuelCardId" TEXT;

-- AlterTable: Expense gains the same optional link (mirrors FuelLog.fuelCardId)
ALTER TABLE "Expense" ADD COLUMN "fuelCardId" TEXT;

-- CreateIndex
CREATE INDEX "FuelLog_fuelCardId_idx" ON "FuelLog"("fuelCardId");

-- AddForeignKey
ALTER TABLE "FuelLog" ADD CONSTRAINT "FuelLog_fuelCardId_fkey" FOREIGN KEY ("fuelCardId") REFERENCES "FuelCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_fuelCardId_fkey" FOREIGN KEY ("fuelCardId") REFERENCES "FuelCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;
