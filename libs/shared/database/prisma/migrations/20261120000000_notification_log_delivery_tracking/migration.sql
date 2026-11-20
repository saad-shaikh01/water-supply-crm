-- AlterTable
ALTER TABLE "NotificationLog" ADD COLUMN "errorCode" TEXT,
ADD COLUMN "errorStage" TEXT,
ADD COLUMN "retryable" BOOLEAN,
ADD COLUMN "waMessageId" TEXT,
ADD COLUMN "deliveryStatus" TEXT,
ADD COLUMN "deliveredAt" TIMESTAMP(3),
ADD COLUMN "readAt" TIMESTAMP(3),
ADD COLUMN "deliveryError" TEXT,
ADD COLUMN "retryOfId" TEXT;

-- CreateIndex
CREATE INDEX "NotificationLog_waMessageId_idx" ON "NotificationLog"("waMessageId");

-- CreateIndex
CREATE INDEX "NotificationLog_retryOfId_idx" ON "NotificationLog"("retryOfId");
