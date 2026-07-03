-- Add filter context + per-customer results to ReminderSendLog for send-history detail view.
ALTER TABLE "ReminderSendLog" ADD COLUMN "minBalance" DOUBLE PRECISION;
ALTER TABLE "ReminderSendLog" ADD COLUMN "paymentType" TEXT;
ALTER TABLE "ReminderSendLog" ADD COLUMN "vanId" TEXT;
ALTER TABLE "ReminderSendLog" ADD COLUMN "dayOfWeek" INTEGER;
ALTER TABLE "ReminderSendLog" ADD COLUMN "force" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ReminderSendLog" ADD COLUMN "details" JSONB;
