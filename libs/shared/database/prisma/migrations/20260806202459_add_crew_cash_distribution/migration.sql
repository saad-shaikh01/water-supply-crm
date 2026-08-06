-- CreateEnum
CREATE TYPE "CrewCashCategory" AS ENUM ('MEAL', 'TEA', 'WATER', 'SNACKS', 'OPERATIONAL_CASH', 'EMERGENCY_CASH', 'OTHER');

-- CreateEnum
CREATE TYPE "CrewCashAuditAction" AS ENUM ('CREATED', 'EDITED', 'DELETED', 'APPROVED', 'SYNCED', 'REVERSED', 'CORRECTED');

-- AlterEnum
ALTER TYPE "StaffLedgerCategory" ADD VALUE 'CREW_CASH';

-- CreateTable
CREATE TABLE "CrewCashDistribution" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "dailySheetId" TEXT NOT NULL,
    "distributedById" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "category" "CrewCashCategory" NOT NULL,
    "amount" INTEGER NOT NULL,
    "notes" TEXT,
    "photoKeys" TEXT[],
    "date" TIMESTAMP(3) NOT NULL,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "syncedLedgerEntryId" TEXT,
    "createdById" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrewCashDistribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrewCashDistributionAuditLog" (
    "id" TEXT NOT NULL,
    "crewCashDistributionId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRole" "UserRole" NOT NULL,
    "action" "CrewCashAuditAction" NOT NULL,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrewCashDistributionAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrewCashDistribution_syncedLedgerEntryId_key" ON "CrewCashDistribution"("syncedLedgerEntryId");

-- CreateIndex
CREATE INDEX "CrewCashDistribution_vendorId_dailySheetId_idx" ON "CrewCashDistribution"("vendorId", "dailySheetId");

-- CreateIndex
CREATE INDEX "CrewCashDistribution_vendorId_employeeId_idx" ON "CrewCashDistribution"("vendorId", "employeeId");

-- CreateIndex
CREATE INDEX "CrewCashDistribution_dailySheetId_idx" ON "CrewCashDistribution"("dailySheetId");

-- CreateIndex
CREATE INDEX "CrewCashDistribution_syncedLedgerEntryId_idx" ON "CrewCashDistribution"("syncedLedgerEntryId");

-- CreateIndex
CREATE INDEX "CrewCashDistributionAuditLog_crewCashDistributionId_idx" ON "CrewCashDistributionAuditLog"("crewCashDistributionId");

-- CreateIndex
CREATE INDEX "CrewCashDistributionAuditLog_crewCashDistributionId_created_idx" ON "CrewCashDistributionAuditLog"("crewCashDistributionId", "createdAt");

-- AddForeignKey
ALTER TABLE "CrewCashDistribution" ADD CONSTRAINT "CrewCashDistribution_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewCashDistribution" ADD CONSTRAINT "CrewCashDistribution_dailySheetId_fkey" FOREIGN KEY ("dailySheetId") REFERENCES "DailySheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewCashDistribution" ADD CONSTRAINT "CrewCashDistribution_distributedById_fkey" FOREIGN KEY ("distributedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewCashDistribution" ADD CONSTRAINT "CrewCashDistribution_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewCashDistribution" ADD CONSTRAINT "CrewCashDistribution_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewCashDistribution" ADD CONSTRAINT "CrewCashDistribution_syncedLedgerEntryId_fkey" FOREIGN KEY ("syncedLedgerEntryId") REFERENCES "StaffLedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewCashDistribution" ADD CONSTRAINT "CrewCashDistribution_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewCashDistributionAuditLog" ADD CONSTRAINT "CrewCashDistributionAuditLog_crewCashDistributionId_fkey" FOREIGN KEY ("crewCashDistributionId") REFERENCES "CrewCashDistribution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewCashDistributionAuditLog" ADD CONSTRAINT "CrewCashDistributionAuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
