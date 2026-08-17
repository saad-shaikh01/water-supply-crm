-- CreateTable
CREATE TABLE "DriverLocationHistory" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "vanId" TEXT,
    "dailySheetId" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "speed" DOUBLE PRECISION,
    "bearing" DOUBLE PRECISION,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverLocationHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverStop" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "vanId" TEXT,
    "dailySheetId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "stopType" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "matchedCustomerId" TEXT,
    "matchedCustomerName" TEXT,
    "matchedDeliveryItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverStop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverRouteSummary" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "vanId" TEXT,
    "dailySheetId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "totalDistanceMeters" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "movingDurationSeconds" INTEGER NOT NULL DEFAULT 0,
    "stopDurationSeconds" INTEGER NOT NULL DEFAULT 0,
    "stopsCount" INTEGER NOT NULL DEFAULT 0,
    "avgSpeedKmh" DOUBLE PRECISION,
    "maxSpeedKmh" DOUBLE PRECISION,
    "pointsCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverRouteSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DriverLocationHistory_driverId_recordedAt_idx" ON "DriverLocationHistory"("driverId", "recordedAt");

-- CreateIndex
CREATE INDEX "DriverLocationHistory_vendorId_recordedAt_idx" ON "DriverLocationHistory"("vendorId", "recordedAt");

-- CreateIndex
CREATE INDEX "DriverLocationHistory_dailySheetId_idx" ON "DriverLocationHistory"("dailySheetId");

-- CreateIndex
CREATE INDEX "DriverStop_driverId_date_idx" ON "DriverStop"("driverId", "date");

-- CreateIndex
CREATE INDEX "DriverStop_vendorId_date_idx" ON "DriverStop"("vendorId", "date");

-- CreateIndex
CREATE INDEX "DriverStop_dailySheetId_idx" ON "DriverStop"("dailySheetId");

-- CreateIndex
CREATE INDEX "DriverRouteSummary_vendorId_date_idx" ON "DriverRouteSummary"("vendorId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DriverRouteSummary_driverId_date_key" ON "DriverRouteSummary"("driverId", "date");

-- AddForeignKey
ALTER TABLE "DriverLocationHistory" ADD CONSTRAINT "DriverLocationHistory_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverLocationHistory" ADD CONSTRAINT "DriverLocationHistory_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverStop" ADD CONSTRAINT "DriverStop_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverStop" ADD CONSTRAINT "DriverStop_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverRouteSummary" ADD CONSTRAINT "DriverRouteSummary_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverRouteSummary" ADD CONSTRAINT "DriverRouteSummary_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
