-- Re-key Conversation from one-per-DailySheetItem to one-per-customer
-- (Communication Center redesign, 2026-07-17). Run
-- `node merge-conversations-per-customer.mjs` BEFORE this migration if the
-- target database has any existing Conversation rows — the new unique
-- constraint on (vendorId, customerId) will fail while duplicates exist.

-- DropForeignKey
ALTER TABLE "Conversation" DROP CONSTRAINT "Conversation_dailySheetId_fkey";

-- DropForeignKey
ALTER TABLE "Conversation" DROP CONSTRAINT "Conversation_dailySheetItemId_fkey";

-- DropForeignKey
ALTER TABLE "Conversation" DROP CONSTRAINT "Conversation_driverId_fkey";

-- DropForeignKey
ALTER TABLE "Conversation" DROP CONSTRAINT "Conversation_vanId_fkey";

-- DropIndex
DROP INDEX "Conversation_customerId_idx";

-- DropIndex
DROP INDEX "Conversation_dailySheetItemId_key";

-- AlterTable
ALTER TABLE "Conversation" ALTER COLUMN "dailySheetItemId" DROP NOT NULL,
ALTER COLUMN "dailySheetId" DROP NOT NULL,
ALTER COLUMN "vanId" DROP NOT NULL,
ALTER COLUMN "driverId" DROP NOT NULL,
ALTER COLUMN "deliveryDate" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_vendorId_customerId_key" ON "Conversation"("vendorId", "customerId");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_dailySheetItemId_fkey" FOREIGN KEY ("dailySheetItemId") REFERENCES "DailySheetItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_dailySheetId_fkey" FOREIGN KEY ("dailySheetId") REFERENCES "DailySheet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_vanId_fkey" FOREIGN KEY ("vanId") REFERENCES "Van"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
