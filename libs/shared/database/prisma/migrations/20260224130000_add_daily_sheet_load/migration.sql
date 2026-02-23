-- CreateTable: DailySheetLoad (multi-trip tracking per daily sheet)
CREATE TABLE "DailySheetLoad" (
  "id" TEXT NOT NULL,
  "dailySheetId" TEXT NOT NULL,
  "tripNumber" INTEGER NOT NULL,
  "loadedFilled" INTEGER NOT NULL,
  "returnedFilled" INTEGER NOT NULL DEFAULT 0,
  "collectedEmpty" INTEGER NOT NULL DEFAULT 0,
  "cashHandedIn" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  CONSTRAINT "DailySheetLoad_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailySheetLoad_dailySheetId_idx" ON "DailySheetLoad"("dailySheetId");

-- AddForeignKey
ALTER TABLE "DailySheetLoad" ADD CONSTRAINT "DailySheetLoad_dailySheetId_fkey"
  FOREIGN KEY ("dailySheetId") REFERENCES "DailySheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
