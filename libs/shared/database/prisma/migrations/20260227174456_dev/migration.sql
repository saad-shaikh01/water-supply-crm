-- CreateEnum
CREATE TYPE "DeliveryType" AS ENUM ('SCHEDULED', 'ON_DEMAND');

-- CreateEnum
CREATE TYPE "DeliveryIssueStatus" AS ENUM ('OPEN', 'PLANNED', 'IN_RETRY', 'RESOLVED', 'DROPPED');

-- CreateEnum
CREATE TYPE "IssueNextAction" AS ENUM ('RETRY_SAME_DAY', 'RETRY_ON_DATE_TIME', 'MOVE_TO_NEXT_REGULAR_DAY', 'SELF_PICKUP', 'CANCEL_ONE_OFF', 'PERMANENT_STOP');

-- CreateEnum
CREATE TYPE "IssueResolution" AS ENUM ('DELIVERED', 'SELF_PICKUP_DONE', 'DROPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DispatchStatus" AS ENUM ('UNPLANNED', 'PLANNED', 'INSERTED_IN_SHEET', 'DELIVERED', 'FAILED', 'SELF_PICKUP_DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DispatchMode" AS ENUM ('INSERT_IN_OPEN_SHEET', 'QUEUE_FOR_GENERATION');

-- AlterTable
ALTER TABLE "CustomerOrder" ADD COLUMN     "dispatchDriverId" TEXT,
ADD COLUMN     "dispatchMode" "DispatchMode",
ADD COLUMN     "dispatchNotes" TEXT,
ADD COLUMN     "dispatchStatus" "DispatchStatus" NOT NULL DEFAULT 'UNPLANNED',
ADD COLUMN     "dispatchVanId" TEXT,
ADD COLUMN     "dispatchedAt" TIMESTAMP(3),
ADD COLUMN     "plannedAt" TIMESTAMP(3),
ADD COLUMN     "plannedById" TEXT,
ADD COLUMN     "targetDate" TIMESTAMP(3),
ADD COLUMN     "timeWindow" TEXT;

-- AlterTable
ALTER TABLE "DailySheetItem" ADD COLUMN     "deliveryType" "DeliveryType" NOT NULL DEFAULT 'SCHEDULED',
ADD COLUMN     "sourceOrderId" TEXT;

-- CreateTable
CREATE TABLE "DeliveryIssue" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "dailySheetItemId" TEXT NOT NULL,
    "status" "DeliveryIssueStatus" NOT NULL DEFAULT 'OPEN',
    "nextAction" "IssueNextAction",
    "retryAt" TIMESTAMP(3),
    "assignedToUserId" TEXT,
    "assignedVanId" TEXT,
    "assignedDriverId" TEXT,
    "planNotes" TEXT,
    "plannedAt" TIMESTAMP(3),
    "plannedById" TEXT,
    "resolution" "IssueResolution",
    "resolvedNotes" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryIssue_dailySheetItemId_key" ON "DeliveryIssue"("dailySheetItemId");

-- CreateIndex
CREATE INDEX "DeliveryIssue_vendorId_status_idx" ON "DeliveryIssue"("vendorId", "status");

-- CreateIndex
CREATE INDEX "DeliveryIssue_vendorId_createdAt_idx" ON "DeliveryIssue"("vendorId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerOrder_vendorId_dispatchStatus_idx" ON "CustomerOrder"("vendorId", "dispatchStatus");

-- AddForeignKey
ALTER TABLE "DeliveryIssue" ADD CONSTRAINT "DeliveryIssue_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryIssue" ADD CONSTRAINT "DeliveryIssue_dailySheetItemId_fkey" FOREIGN KEY ("dailySheetItemId") REFERENCES "DailySheetItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
