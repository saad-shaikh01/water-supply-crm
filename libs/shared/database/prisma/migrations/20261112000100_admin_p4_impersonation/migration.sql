-- CreateEnum
CREATE TYPE "ImpersonationMode" AS ENUM ('READ_ONLY', 'SUPPORT');

-- CreateTable
CREATE TABLE "ImpersonationSession" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "targetName" TEXT NOT NULL,
    "mode" "ImpersonationMode" NOT NULL DEFAULT 'READ_ONLY',
    "reason" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "endedReason" TEXT,
    "actionCount" INTEGER NOT NULL DEFAULT 0,
    "handoffUsedAt" TIMESTAMP(3),

    CONSTRAINT "ImpersonationSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImpersonationSession_vendorId_startedAt_idx" ON "ImpersonationSession"("vendorId", "startedAt");

-- CreateIndex
CREATE INDEX "ImpersonationSession_actorId_startedAt_idx" ON "ImpersonationSession"("actorId", "startedAt");

-- CreateIndex
CREATE INDEX "ImpersonationSession_endedAt_expiresAt_idx" ON "ImpersonationSession"("endedAt", "expiresAt");

