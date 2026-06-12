-- AlterTable
ALTER TABLE "DailySheetItem" ADD COLUMN "editUnlockedBy" TEXT;
ALTER TABLE "DailySheetItem" ADD COLUMN "editUnlockExpiresAt" TIMESTAMP(3);
