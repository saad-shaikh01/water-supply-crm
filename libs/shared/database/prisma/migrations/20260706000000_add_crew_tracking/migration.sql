-- Crew tracking: SALESMAN/LOADER roles, per-sheet crew snapshot, per-van default
-- crew template, and the crew-confirmation workflow on DailySheet.

-- New user roles for no-login field staff
ALTER TYPE "UserRole" ADD VALUE 'SALESMAN';
ALTER TYPE "UserRole" ADD VALUE 'LOADER';

-- Role a person performs on a specific van/trip (separate from auth role)
CREATE TYPE "CrewRole" AS ENUM ('DRIVER', 'SALESMAN', 'LOADER');

-- No-login staff have no credentials
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "User" ALTER COLUMN "password" DROP NOT NULL;

-- Crew confirmation workflow on DailySheet
ALTER TABLE "DailySheet" ADD COLUMN "crewConfirmed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DailySheet" ADD COLUMN "crewConfirmedAt" TIMESTAMP(3);
ALTER TABLE "DailySheet" ADD COLUMN "crewConfirmedById" TEXT;

ALTER TABLE "DailySheet" ADD CONSTRAINT "DailySheet_crewConfirmedById_fkey"
  FOREIGN KEY ("crewConfirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Grandfather all pre-existing sheets so open sheets are not blocked from
-- starting trips after this deploy. Only sheets generated after this migration
-- require explicit crew confirmation.
UPDATE "DailySheet" SET "crewConfirmed" = true;

-- Per-sheet crew snapshot (supporting crew; driver stays on DailySheet.driverId)
CREATE TABLE "DailySheetCrew" (
    "id" TEXT NOT NULL,
    "dailySheetId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "CrewRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailySheetCrew_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DailySheetCrew_dailySheetId_userId_key" ON "DailySheetCrew"("dailySheetId", "userId");
CREATE INDEX "DailySheetCrew_userId_idx" ON "DailySheetCrew"("userId");
CREATE INDEX "DailySheetCrew_dailySheetId_idx" ON "DailySheetCrew"("dailySheetId");

ALTER TABLE "DailySheetCrew" ADD CONSTRAINT "DailySheetCrew_dailySheetId_fkey"
  FOREIGN KEY ("dailySheetId") REFERENCES "DailySheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DailySheetCrew" ADD CONSTRAINT "DailySheetCrew_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Per-van default crew template (copied onto each generated sheet)
CREATE TABLE "VanDefaultCrew" (
    "id" TEXT NOT NULL,
    "vanId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "CrewRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VanDefaultCrew_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VanDefaultCrew_vanId_userId_key" ON "VanDefaultCrew"("vanId", "userId");
CREATE INDEX "VanDefaultCrew_userId_idx" ON "VanDefaultCrew"("userId");

ALTER TABLE "VanDefaultCrew" ADD CONSTRAINT "VanDefaultCrew_vanId_fkey"
  FOREIGN KEY ("vanId") REFERENCES "Van"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VanDefaultCrew" ADD CONSTRAINT "VanDefaultCrew_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
