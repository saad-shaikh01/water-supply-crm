-- Per-vendor WhatsApp Cloud API accounts (additive only; see docs/features/multi-vendor-branding-and-whatsapp.md §3.2)
CREATE TYPE "WhatsAppAccountStatus" AS ENUM ('NOT_CONFIGURED', 'READY', 'TOKEN_INVALID', 'SUSPENDED');

CREATE TABLE "WhatsAppAccount" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "wabaId" TEXT,
    "phoneNumberId" TEXT,
    "displayNumber" TEXT,
    "verifiedName" TEXT,
    "tokenCipher" TEXT,
    "tokenIv" TEXT,
    "tokenTag" TEXT,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "status" "WhatsAppAccountStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "qualityRating" TEXT,
    "lastHealthCheckAt" TIMESTAMP(3),
    "lastHealthError" TEXT,
    "templateSuffix" TEXT,
    "templatesSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WhatsAppTemplate" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "category" TEXT,
    "status" TEXT NOT NULL,
    "rejectedReason" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsAppTemplate_accountId_name_language_key" ON "WhatsAppTemplate"("accountId", "name", "language");

CREATE INDEX "WhatsAppTemplate_accountId_idx" ON "WhatsAppTemplate"("accountId");

ALTER TABLE "WhatsAppTemplate" ADD CONSTRAINT "WhatsAppTemplate_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "WhatsAppAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "WhatsAppAccount_phoneNumberId_key" ON "WhatsAppAccount"("phoneNumberId");

ALTER TABLE "Vendor" ADD COLUMN "whatsappAccountId" TEXT;

ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_whatsappAccountId_fkey" FOREIGN KEY ("whatsappAccountId") REFERENCES "WhatsAppAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
