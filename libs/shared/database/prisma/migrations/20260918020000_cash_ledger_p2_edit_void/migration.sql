-- Cash Ledger redesign — Phase P2 (owner-approved 2026-09-18): edit / void.
--
-- Purely additive (no data rewritten): every existing manual cash-in row becomes
-- status ACTIVE / version 1 / editCount 0; every existing standalone crew-cash
-- row gets version 1 / editCount 0.
--
-- 1. VanCashOpeningBalance ("Manual Cash In") becomes editable in place. The
--    reason + before/after of every edit live in the generic AuditLog; these
--    columns only make the "Edited" badge and optimistic concurrency cheap.
--    Void is a secondary status flip (never a DELETE).
-- 2. StandaloneCrewCashExpense becomes editable in place (its StaffLedgerEntry
--    twin is voided + re-created in the same transaction, only while unlocked).

-- CreateEnum
CREATE TYPE "ManualCashInSource" AS ENUM ('OWNER_INJECTION', 'OPENING_BALANCE', 'REFUND', 'BANK_WITHDRAWAL', 'OTHER');

-- CreateEnum
CREATE TYPE "ManualCashInStatus" AS ENUM ('ACTIVE', 'VOIDED');

-- AlterTable
ALTER TABLE "VanCashOpeningBalance"
  ADD COLUMN "source" "ManualCashInSource",
  ADD COLUMN "status" "ManualCashInStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "editCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastEditedAt" TIMESTAMP(3),
  ADD COLUMN "updatedById" TEXT,
  ADD COLUMN "voidedById" TEXT,
  ADD COLUMN "voidedAt" TIMESTAMP(3),
  ADD COLUMN "voidReason" TEXT;

-- AlterTable
ALTER TABLE "StandaloneCrewCashExpense"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "editCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastEditedAt" TIMESTAMP(3),
  ADD COLUMN "updatedById" TEXT;

-- CreateIndex
CREATE INDEX "VanCashOpeningBalance_vendorId_openingDate_idx" ON "VanCashOpeningBalance"("vendorId", "openingDate");

-- AddForeignKey
ALTER TABLE "VanCashOpeningBalance" ADD CONSTRAINT "VanCashOpeningBalance_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VanCashOpeningBalance" ADD CONSTRAINT "VanCashOpeningBalance_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StandaloneCrewCashExpense" ADD CONSTRAINT "StandaloneCrewCashExpense_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
