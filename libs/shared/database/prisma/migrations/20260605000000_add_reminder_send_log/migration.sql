-- CreateTable
CREATE TABLE "ReminderSendLog" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "sent" INTEGER NOT NULL,
    "skipped" INTEGER NOT NULL,
    "includeStatement" BOOLEAN NOT NULL DEFAULT false,
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReminderSendLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReminderSendLog_vendorId_createdAt_idx" ON "ReminderSendLog"("vendorId", "createdAt");

-- AddForeignKey
ALTER TABLE "ReminderSendLog" ADD CONSTRAINT "ReminderSendLog_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
