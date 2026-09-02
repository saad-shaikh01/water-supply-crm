-- Phase 2 (Overdue Warning): per-vendor knobs. Missing row = defaults.

-- CreateTable
CREATE TABLE "BalanceReminderConfig" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "warningDelayDays" INTEGER NOT NULL DEFAULT 3,
    "warningMinBalance" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "autoWarningsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BalanceReminderConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BalanceReminderConfig_vendorId_key" ON "BalanceReminderConfig"("vendorId");

-- CreateIndex
CREATE INDEX "BalanceReminderConfig_vendorId_idx" ON "BalanceReminderConfig"("vendorId");

-- AddForeignKey
ALTER TABLE "BalanceReminderConfig" ADD CONSTRAINT "BalanceReminderConfig_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
