-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "recipientAddress" TEXT,
    "eventType" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "recipientType" TEXT,
    "recipientId" TEXT,
    "vendorId" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "lastError" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationLog_channel_status_idx" ON "NotificationLog"("channel", "status");

-- CreateIndex
CREATE INDEX "NotificationLog_vendorId_createdAt_idx" ON "NotificationLog"("vendorId", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationLog_createdAt_idx" ON "NotificationLog"("createdAt");
