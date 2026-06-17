-- AlterTable: Add ad-hoc correction tracking fields to DailySheetItem
ALTER TABLE "DailySheetItem" ADD COLUMN "isCorrection" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DailySheetItem" ADD COLUMN "correctionAddedAt" TIMESTAMP(3);
ALTER TABLE "DailySheetItem" ADD COLUMN "correctionNote" TEXT;
