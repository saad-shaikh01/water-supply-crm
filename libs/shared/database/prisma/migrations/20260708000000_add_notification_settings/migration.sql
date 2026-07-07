-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('DELIVERY_RECEIPT', 'MONTHLY_STATEMENT', 'PAYMENT_RECEIVED', 'ORDER_UPDATE', 'TICKET_REPLY');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('WHATSAPP', 'PUSH');

-- CreateTable
CREATE TABLE "NotificationSetting" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationSetting_vendorId_idx" ON "NotificationSetting"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationSetting_vendorId_type_channel_key" ON "NotificationSetting"("vendorId", "type", "channel");

-- AddForeignKey
ALTER TABLE "NotificationSetting" ADD CONSTRAINT "NotificationSetting_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
