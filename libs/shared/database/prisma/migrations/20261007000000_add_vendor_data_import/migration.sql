-- CreateEnum
CREATE TYPE "ImportEntity" AS ENUM ('CUSTOMERS_OPENING');

-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('UPLOADED', 'MAPPED', 'QUEUED', 'EXECUTING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'CANCELLED', 'REVERTED', 'PARTIALLY_REVERTED');

-- CreateEnum
CREATE TYPE "ImportRowAction" AS ENUM ('CREATE', 'UPDATE', 'SKIP_EXISTING', 'SKIP_INVALID');

-- CreateEnum
CREATE TYPE "ImportRowResult" AS ENUM ('PENDING', 'CREATED', 'UPDATED', 'SKIPPED', 'FAILED', 'REVERTED', 'REVERT_SKIPPED');

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "entity" "ImportEntity" NOT NULL,
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'UPLOADED',
    "sourceFileKey" TEXT,
    "sourceFileName" TEXT NOT NULL,
    "sourceFileSize" INTEGER NOT NULL,
    "sourceFileSha256" TEXT NOT NULL,
    "sheetName" TEXT,
    "headerRowIndex" INTEGER NOT NULL DEFAULT 1,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "mapping" JSONB,
    "options" JSONB,
    "profileId" TEXT,
    "summary" JSONB,
    "planHash" TEXT,
    "plannedAt" TIMESTAMP(3),
    "jobId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "revertedAt" TIMESTAMP(3),
    "revertedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRow" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "raw" JSONB NOT NULL,
    "normalized" JSONB,
    "issues" JSONB,
    "action" "ImportRowAction",
    "diff" JSONB,
    "result" "ImportRowResult" NOT NULL DEFAULT 'PENDING',
    "resultCode" TEXT,
    "resultMessage" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "appliedSnapshot" JSONB,

    CONSTRAINT "ImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportMappingProfile" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "entity" "ImportEntity" NOT NULL,
    "name" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "columnMap" JSONB NOT NULL,
    "valueMaps" JSONB,
    "optionDefaults" JSONB,
    "lastUsedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportMappingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportBatch_vendorId_createdAt_idx" ON "ImportBatch"("vendorId", "createdAt");

-- CreateIndex
CREATE INDEX "ImportBatch_vendorId_entity_status_idx" ON "ImportBatch"("vendorId", "entity", "status");

-- CreateIndex
CREATE INDEX "ImportBatch_vendorId_sourceFileSha256_idx" ON "ImportBatch"("vendorId", "sourceFileSha256");

-- CreateIndex
CREATE INDEX "ImportRow_batchId_action_idx" ON "ImportRow"("batchId", "action");

-- CreateIndex
CREATE INDEX "ImportRow_batchId_result_idx" ON "ImportRow"("batchId", "result");

-- CreateIndex
CREATE INDEX "ImportRow_entityType_entityId_idx" ON "ImportRow"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportRow_batchId_rowNumber_key" ON "ImportRow"("batchId", "rowNumber");

-- CreateIndex
CREATE INDEX "ImportMappingProfile_vendorId_entity_fingerprint_idx" ON "ImportMappingProfile"("vendorId", "entity", "fingerprint");

-- CreateIndex
CREATE INDEX "ImportMappingProfile_isSystem_entity_fingerprint_idx" ON "ImportMappingProfile"("isSystem", "entity", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "ImportMappingProfile_vendorId_entity_name_key" ON "ImportMappingProfile"("vendorId", "entity", "name");

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportMappingProfile" ADD CONSTRAINT "ImportMappingProfile_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

