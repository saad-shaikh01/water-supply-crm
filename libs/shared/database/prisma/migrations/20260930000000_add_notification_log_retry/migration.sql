-- AlterTable
ALTER TABLE "NotificationLog" ADD COLUMN "jobName" TEXT,
ADD COLUMN "payload" JSONB,
ADD COLUMN "retriedAt" TIMESTAMP(3);
