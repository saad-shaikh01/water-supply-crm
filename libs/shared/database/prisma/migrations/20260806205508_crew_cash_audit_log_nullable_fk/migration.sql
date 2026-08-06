-- DropForeignKey
ALTER TABLE "CrewCashDistributionAuditLog" DROP CONSTRAINT "CrewCashDistributionAuditLog_crewCashDistributionId_fkey";

-- AlterTable
ALTER TABLE "CrewCashDistributionAuditLog" ALTER COLUMN "crewCashDistributionId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "CrewCashDistributionAuditLog" ADD CONSTRAINT "CrewCashDistributionAuditLog_crewCashDistributionId_fkey" FOREIGN KEY ("crewCashDistributionId") REFERENCES "CrewCashDistribution"("id") ON DELETE SET NULL ON UPDATE CASCADE;
