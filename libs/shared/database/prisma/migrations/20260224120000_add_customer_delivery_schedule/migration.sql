-- CreateTable: CustomerDeliverySchedule
CREATE TABLE "CustomerDeliverySchedule" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "vanId" TEXT NOT NULL,
  "dayOfWeek" INTEGER NOT NULL,
  "routeSequence" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomerDeliverySchedule_pkey" PRIMARY KEY ("id")
);

-- CreateUnique
CREATE UNIQUE INDEX "CustomerDeliverySchedule_customerId_dayOfWeek_key"
  ON "CustomerDeliverySchedule"("customerId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "CustomerDeliverySchedule_vanId_dayOfWeek_idx"
  ON "CustomerDeliverySchedule"("vanId", "dayOfWeek");

-- AddForeignKey
ALTER TABLE "CustomerDeliverySchedule" ADD CONSTRAINT "CustomerDeliverySchedule_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CustomerDeliverySchedule" ADD CONSTRAINT "CustomerDeliverySchedule_vanId_fkey"
  FOREIGN KEY ("vanId") REFERENCES "Van"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: remove deliveryDays and routeSequence from Customer
ALTER TABLE "Customer" DROP COLUMN IF EXISTS "deliveryDays";
ALTER TABLE "Customer" DROP COLUMN IF EXISTS "routeSequence";

-- AlterTable: make DailySheet.routeId nullable
ALTER TABLE "DailySheet" ALTER COLUMN "routeId" DROP NOT NULL;

-- DropIndex: customer routeId/routeSequence index
DROP INDEX IF EXISTS "Customer_routeId_routeSequence_idx";
