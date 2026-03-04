-- CreateTable
CREATE TABLE "DriverLastLocation" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "speed" DOUBLE PRECISION,
    "bearing" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'ONLINE',
    "vanId" TEXT,
    "dailySheetId" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverLastLocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DriverLastLocation_driverId_key" ON "DriverLastLocation"("driverId");

-- CreateIndex
CREATE INDEX "DriverLastLocation_vendorId_idx" ON "DriverLastLocation"("vendorId");

-- CreateIndex
CREATE INDEX "DriverLastLocation_vendorId_lastSeenAt_idx" ON "DriverLastLocation"("vendorId", "lastSeenAt");

-- AddForeignKey
ALTER TABLE "DriverLastLocation" ADD CONSTRAINT "DriverLastLocation_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverLastLocation" ADD CONSTRAINT "DriverLastLocation_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
