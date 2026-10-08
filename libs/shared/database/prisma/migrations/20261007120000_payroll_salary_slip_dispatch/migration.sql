-- CreateEnum
CREATE TYPE "PayrollSlipDispatchStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'ABORTED', 'FAILED');

-- CreateEnum
CREATE TYPE "PayrollSlipDeliveryStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'SKIPPED_NO_PHONE', 'SKIPPED_DISCONNECTED', 'FAILED');

-- CreateTable
CREATE TABLE "PayrollSlipDispatch" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "status" "PayrollSlipDispatchStatus" NOT NULL DEFAULT 'QUEUED',
    "total" INTEGER NOT NULL,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "PayrollSlipDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollSlipDelivery" (
    "id" TEXT NOT NULL,
    "dispatchId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "payrollEntryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "phone" TEXT,
    "status" "PayrollSlipDeliveryStatus" NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "finalPayable" INTEGER NOT NULL,
    "entryVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "PayrollSlipDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayrollSlipDispatch_vendorId_periodId_createdAt_idx" ON "PayrollSlipDispatch"("vendorId", "periodId", "createdAt");

-- CreateIndex
CREATE INDEX "PayrollSlipDelivery_dispatchId_idx" ON "PayrollSlipDelivery"("dispatchId");

-- CreateIndex
CREATE INDEX "PayrollSlipDelivery_payrollEntryId_status_idx" ON "PayrollSlipDelivery"("payrollEntryId", "status");

-- CreateIndex
CREATE INDEX "PayrollSlipDelivery_vendorId_periodId_createdAt_idx" ON "PayrollSlipDelivery"("vendorId", "periodId", "createdAt");

-- AddForeignKey
ALTER TABLE "PayrollSlipDelivery" ADD CONSTRAINT "PayrollSlipDelivery_dispatchId_fkey" FOREIGN KEY ("dispatchId") REFERENCES "PayrollSlipDispatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollSlipDelivery" ADD CONSTRAINT "PayrollSlipDelivery_payrollEntryId_fkey" FOREIGN KEY ("payrollEntryId") REFERENCES "PayrollEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

