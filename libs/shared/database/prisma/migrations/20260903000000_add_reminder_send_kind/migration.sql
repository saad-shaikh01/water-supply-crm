-- Phase 1 (Statement-only mode): discriminate reminder-send operations by kind.
-- Additive only. Every existing ReminderSendLog row becomes 'REMINDER'.
-- (The WARNING value is added by the Phase 2 migration when that flow ships.)

-- CreateEnum
CREATE TYPE "ReminderSendKind" AS ENUM ('REMINDER', 'STATEMENT_ONLY');

-- AlterTable
ALTER TABLE "ReminderSendLog" ADD COLUMN "kind" "ReminderSendKind" NOT NULL DEFAULT 'REMINDER';

-- CreateIndex
CREATE INDEX "ReminderSendLog_vendorId_month_kind_idx" ON "ReminderSendLog"("vendorId", "month", "kind");
