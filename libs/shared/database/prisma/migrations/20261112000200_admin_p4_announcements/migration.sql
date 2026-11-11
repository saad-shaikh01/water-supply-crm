-- CreateEnum
CREATE TYPE "AnnouncementStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "AnnouncementAudience" AS ENUM ('ALL_VENDORS', 'SELECTED_VENDORS');

-- CreateEnum
CREATE TYPE "AnnouncementSeverity" AS ENUM ('INFO', 'IMPORTANT', 'CRITICAL');

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "severity" "AnnouncementSeverity" NOT NULL DEFAULT 'INFO',
    "audience" "AnnouncementAudience" NOT NULL DEFAULT 'ALL_VENDORS',
    "status" "AnnouncementStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledFor" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnnouncementVendor" (
    "announcementId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,

    CONSTRAINT "AnnouncementVendor_pkey" PRIMARY KEY ("announcementId","vendorId")
);

-- CreateIndex
CREATE INDEX "Announcement_status_scheduledFor_idx" ON "Announcement"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "AnnouncementVendor_vendorId_idx" ON "AnnouncementVendor"("vendorId");

-- CreateIndex
CREATE INDEX "InAppNotification_type_entityId_idx" ON "InAppNotification"("type", "entityId");

-- AddForeignKey
ALTER TABLE "AnnouncementVendor" ADD CONSTRAINT "AnnouncementVendor_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementVendor" ADD CONSTRAINT "AnnouncementVendor_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

