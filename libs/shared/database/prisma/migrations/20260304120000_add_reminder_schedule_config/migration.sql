-- CreateTable
CREATE TABLE "ReminderScheduleConfig" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "cronExpression" TEXT NOT NULL,
    "minBalance" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReminderScheduleConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReminderScheduleConfig_vendorId_key" ON "ReminderScheduleConfig"("vendorId");

-- CreateIndex
CREATE INDEX "ReminderScheduleConfig_vendorId_idx" ON "ReminderScheduleConfig"("vendorId");

-- AddForeignKey
ALTER TABLE "ReminderScheduleConfig" ADD CONSTRAINT "ReminderScheduleConfig_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
