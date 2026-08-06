-- CreateEnum
CREATE TYPE "PayrollAuditAction" AS ENUM ('GENERATED', 'REGENERATED', 'APPROVED', 'LOCKED', 'UNLOCKED', 'SETTLED');

-- CreateTable
CREATE TABLE "PayrollEntryAuditLog" (
    "id" TEXT NOT NULL,
    "payrollEntryId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRole" "UserRole" NOT NULL,
    "action" "PayrollAuditAction" NOT NULL,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollEntryAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayrollEntryAuditLog_payrollEntryId_idx" ON "PayrollEntryAuditLog"("payrollEntryId");

-- CreateIndex
CREATE INDEX "PayrollEntryAuditLog_payrollEntryId_createdAt_idx" ON "PayrollEntryAuditLog"("payrollEntryId", "createdAt");

-- AddForeignKey
ALTER TABLE "PayrollEntryAuditLog" ADD CONSTRAINT "PayrollEntryAuditLog_payrollEntryId_fkey" FOREIGN KEY ("payrollEntryId") REFERENCES "PayrollEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollEntryAuditLog" ADD CONSTRAINT "PayrollEntryAuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
