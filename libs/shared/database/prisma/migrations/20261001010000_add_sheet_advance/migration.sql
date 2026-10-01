-- Daily Sheet Advances (owner-requested 2026-10-01).
-- A salary advance handed to an employee out of the van's cash during a Daily
-- Sheet. Each row owns one StaffLedgerEntry (category ADVANCE) "payroll twin"; the
-- Cash Ledger's payroll-advance source excludes twins that point back at a
-- SheetAdvance (the cash left via the sheet's hand-in, not the office box).
--
-- PURELY ADDITIVE: one new enum + one new table + its indexes/FKs. No existing
-- table or column is altered, so nothing about current data or behaviour changes.

-- CreateEnum
CREATE TYPE "SheetAdvanceStatus" AS ENUM ('ACTIVE', 'VOIDED');

-- CreateTable
CREATE TABLE "SheetAdvance" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "dailySheetId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "notes" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "status" "SheetAdvanceStatus" NOT NULL DEFAULT 'ACTIVE',
    "staffLedgerEntryId" TEXT NOT NULL,
    "dailySheetLoadId" TEXT,
    "createdById" TEXT NOT NULL,
    "voidedById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "editCount" INTEGER NOT NULL DEFAULT 0,
    "lastEditedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SheetAdvance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SheetAdvance_staffLedgerEntryId_key" ON "SheetAdvance"("staffLedgerEntryId");

-- CreateIndex
CREATE INDEX "SheetAdvance_vendorId_dailySheetId_idx" ON "SheetAdvance"("vendorId", "dailySheetId");

-- CreateIndex
CREATE INDEX "SheetAdvance_dailySheetId_idx" ON "SheetAdvance"("dailySheetId");

-- CreateIndex
CREATE INDEX "SheetAdvance_vendorId_employeeId_idx" ON "SheetAdvance"("vendorId", "employeeId");

-- CreateIndex
CREATE INDEX "SheetAdvance_dailySheetLoadId_idx" ON "SheetAdvance"("dailySheetLoadId");

-- AddForeignKey
ALTER TABLE "SheetAdvance" ADD CONSTRAINT "SheetAdvance_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetAdvance" ADD CONSTRAINT "SheetAdvance_dailySheetId_fkey" FOREIGN KEY ("dailySheetId") REFERENCES "DailySheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetAdvance" ADD CONSTRAINT "SheetAdvance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetAdvance" ADD CONSTRAINT "SheetAdvance_staffLedgerEntryId_fkey" FOREIGN KEY ("staffLedgerEntryId") REFERENCES "StaffLedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetAdvance" ADD CONSTRAINT "SheetAdvance_dailySheetLoadId_fkey" FOREIGN KEY ("dailySheetLoadId") REFERENCES "DailySheetLoad"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetAdvance" ADD CONSTRAINT "SheetAdvance_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetAdvance" ADD CONSTRAINT "SheetAdvance_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

