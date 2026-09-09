-- Van Cash Ledger (owner-requested 2026-09-09).
--
-- Adds the "cash in" side to the Expense Center: when a route's Daily Sheet
-- closes, the cash it collected becomes a pending VanCashHandover that office
-- staff must approve before it counts toward the van's running cash balance.
-- Mirrors CrewCashDistribution's architecture (source record -> pending ->
-- approve -> posted, self-relation for post-close corrections).
--
-- VanCashOpeningBalance: one row per van, the starting cash balance assumed
-- before the ledger started tracking it.
--
-- VanCashHandover: one row per Daily Sheet close event; correction rows point
-- back at the row they correct via correctsEntryId and carry the DELTA (not
-- the new total) as their own amount. Deliberately NO unique index on
-- dailySheetId alone — a correction row legitimately shares its parent's
-- dailySheetId; "at most one non-correction handover per sheet" is enforced
-- in application code (VanCashLedgerService), not the database.
--
-- Purely additive: two new tables + one new enum, no existing table altered.

-- CreateEnum
CREATE TYPE "VanCashHandoverStatus" AS ENUM ('PENDING', 'APPROVED', 'VOIDED');

-- CreateTable
CREATE TABLE "VanCashOpeningBalance" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "vanId" TEXT NOT NULL,
    "openingBalance" DOUBLE PRECISION NOT NULL,
    "openingDate" TIMESTAMP(3) NOT NULL,
    "setById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VanCashOpeningBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VanCashHandover" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "vanId" TEXT NOT NULL,
    "dailySheetId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "submittedById" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "status" "VanCashHandoverStatus" NOT NULL DEFAULT 'PENDING',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedAmount" DOUBLE PRECISION,
    "adjustmentReason" TEXT,
    "correctsEntryId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VanCashHandover_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VanCashOpeningBalance_vanId_key" ON "VanCashOpeningBalance"("vanId");

-- CreateIndex
CREATE INDEX "VanCashOpeningBalance_vendorId_idx" ON "VanCashOpeningBalance"("vendorId");

-- CreateIndex
CREATE INDEX "VanCashHandover_vendorId_vanId_date_idx" ON "VanCashHandover"("vendorId", "vanId", "date");

-- CreateIndex
CREATE INDEX "VanCashHandover_vendorId_status_idx" ON "VanCashHandover"("vendorId", "status");

-- CreateIndex
CREATE INDEX "VanCashHandover_dailySheetId_idx" ON "VanCashHandover"("dailySheetId");

-- CreateIndex
CREATE INDEX "VanCashHandover_correctsEntryId_idx" ON "VanCashHandover"("correctsEntryId");

-- AddForeignKey
ALTER TABLE "VanCashOpeningBalance" ADD CONSTRAINT "VanCashOpeningBalance_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VanCashOpeningBalance" ADD CONSTRAINT "VanCashOpeningBalance_vanId_fkey" FOREIGN KEY ("vanId") REFERENCES "Van"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VanCashOpeningBalance" ADD CONSTRAINT "VanCashOpeningBalance_setById_fkey" FOREIGN KEY ("setById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VanCashHandover" ADD CONSTRAINT "VanCashHandover_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VanCashHandover" ADD CONSTRAINT "VanCashHandover_vanId_fkey" FOREIGN KEY ("vanId") REFERENCES "Van"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VanCashHandover" ADD CONSTRAINT "VanCashHandover_dailySheetId_fkey" FOREIGN KEY ("dailySheetId") REFERENCES "DailySheet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VanCashHandover" ADD CONSTRAINT "VanCashHandover_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VanCashHandover" ADD CONSTRAINT "VanCashHandover_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VanCashHandover" ADD CONSTRAINT "VanCashHandover_correctsEntryId_fkey" FOREIGN KEY ("correctsEntryId") REFERENCES "VanCashHandover"("id") ON DELETE SET NULL ON UPDATE CASCADE;
