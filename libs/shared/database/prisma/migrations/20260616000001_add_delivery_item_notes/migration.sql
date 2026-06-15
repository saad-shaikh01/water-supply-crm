-- CreateEnum
CREATE TYPE "NoteType" AS ENUM ('TEXT', 'VOICE');

-- CreateTable
CREATE TABLE "DeliveryItemNote" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "dailySheetItemId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "type" "NoteType" NOT NULL,
    "text" TEXT,
    "audioKey" TEXT,
    "audioDuration" INTEGER,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryItemNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeliveryItemNote_dailySheetItemId_idx" ON "DeliveryItemNote"("dailySheetItemId");

-- CreateIndex
CREATE INDEX "DeliveryItemNote_dailySheetItemId_acknowledgedAt_idx" ON "DeliveryItemNote"("dailySheetItemId", "acknowledgedAt");

-- CreateIndex
CREATE INDEX "DeliveryItemNote_vendorId_idx" ON "DeliveryItemNote"("vendorId");

-- AddForeignKey
ALTER TABLE "DeliveryItemNote" ADD CONSTRAINT "DeliveryItemNote_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryItemNote" ADD CONSTRAINT "DeliveryItemNote_dailySheetItemId_fkey" FOREIGN KEY ("dailySheetItemId") REFERENCES "DailySheetItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryItemNote" ADD CONSTRAINT "DeliveryItemNote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
