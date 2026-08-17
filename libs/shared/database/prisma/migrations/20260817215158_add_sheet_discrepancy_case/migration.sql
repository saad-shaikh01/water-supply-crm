-- CreateEnum
CREATE TYPE "DiscrepancyType" AS ENUM ('BOTTLE', 'EMPTY', 'CASH');

-- CreateEnum
CREATE TYPE "DiscrepancyCaseStatus" AS ENUM ('REPORTED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "DiscrepancyResolutionType" AS ENUM ('CHARGED_TO_DRIVER', 'COMPANY_LOSS', 'WAIVED');

-- AlterEnum
ALTER TYPE "ExpenseCategory" ADD VALUE 'DISCREPANCY_WRITE_OFF';

-- CreateTable
CREATE TABLE "SheetDiscrepancyCase" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "dailySheetId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "type" "DiscrepancyType" NOT NULL,
    "reportedQuantity" INTEGER,
    "reportedAmount" DOUBLE PRECISION,
    "status" "DiscrepancyCaseStatus" NOT NULL DEFAULT 'REPORTED',
    "version" INTEGER NOT NULL DEFAULT 0,
    "resolutionType" "DiscrepancyResolutionType",
    "resolutionAmount" DOUBLE PRECISION,
    "resolutionNote" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "staffLedgerEntryId" TEXT,
    "expenseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SheetDiscrepancyCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SheetDiscrepancyCaseAuditLog" (
    "id" TEXT NOT NULL,
    "discrepancyCaseId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SheetDiscrepancyCaseAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SheetDiscrepancyCase_staffLedgerEntryId_key" ON "SheetDiscrepancyCase"("staffLedgerEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "SheetDiscrepancyCase_expenseId_key" ON "SheetDiscrepancyCase"("expenseId");

-- CreateIndex
CREATE INDEX "SheetDiscrepancyCase_vendorId_status_idx" ON "SheetDiscrepancyCase"("vendorId", "status");

-- CreateIndex
CREATE INDEX "SheetDiscrepancyCase_dailySheetId_idx" ON "SheetDiscrepancyCase"("dailySheetId");

-- CreateIndex
CREATE INDEX "SheetDiscrepancyCase_driverId_idx" ON "SheetDiscrepancyCase"("driverId");

-- CreateIndex
CREATE INDEX "SheetDiscrepancyCaseAuditLog_discrepancyCaseId_idx" ON "SheetDiscrepancyCaseAuditLog"("discrepancyCaseId");

-- CreateIndex
CREATE INDEX "SheetDiscrepancyCaseAuditLog_discrepancyCaseId_createdAt_idx" ON "SheetDiscrepancyCaseAuditLog"("discrepancyCaseId", "createdAt");

-- AddForeignKey
ALTER TABLE "SheetDiscrepancyCase" ADD CONSTRAINT "SheetDiscrepancyCase_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetDiscrepancyCase" ADD CONSTRAINT "SheetDiscrepancyCase_dailySheetId_fkey" FOREIGN KEY ("dailySheetId") REFERENCES "DailySheet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetDiscrepancyCase" ADD CONSTRAINT "SheetDiscrepancyCase_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetDiscrepancyCase" ADD CONSTRAINT "SheetDiscrepancyCase_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetDiscrepancyCase" ADD CONSTRAINT "SheetDiscrepancyCase_staffLedgerEntryId_fkey" FOREIGN KEY ("staffLedgerEntryId") REFERENCES "StaffLedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetDiscrepancyCase" ADD CONSTRAINT "SheetDiscrepancyCase_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetDiscrepancyCaseAuditLog" ADD CONSTRAINT "SheetDiscrepancyCaseAuditLog_discrepancyCaseId_fkey" FOREIGN KEY ("discrepancyCaseId") REFERENCES "SheetDiscrepancyCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
