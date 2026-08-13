-- CreateEnum
CREATE TYPE "VehicleFuelType" AS ENUM ('PETROL', 'DIESEL', 'CNG', 'HYBRID', 'ELECTRIC');

-- CreateEnum
CREATE TYPE "VehicleOwnershipType" AS ENUM ('OWNED', 'LEASED', 'RENTED', 'FINANCED');

-- CreateEnum
CREATE TYPE "VehicleOperationalStatus" AS ENUM ('ACTIVE', 'IN_MAINTENANCE', 'RETIRED');

-- CreateEnum
CREATE TYPE "VehicleDocumentType" AS ENUM ('REGISTRATION', 'INSURANCE', 'FITNESS_CERTIFICATE', 'ROUTE_PERMIT', 'TAX_TOKEN', 'LOAN_AGREEMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "VehicleCheckType" AS ENUM ('START', 'END');

-- CreateEnum
CREATE TYPE "VehicleServiceType" AS ENUM ('ENGINE_OIL', 'OIL_FILTER', 'AIR_FILTER', 'FUEL_FILTER', 'BRAKE_FLUID', 'BRAKE_PADS', 'COOLANT', 'TRANSMISSION_FLUID', 'TYRE_ROTATION', 'BATTERY', 'SUSPENSION', 'CLUTCH', 'TIMING_BELT', 'SPARK_PLUGS', 'WHEEL_ALIGNMENT', 'AC_SERVICE', 'GENERAL_INSPECTION', 'OTHER');

-- CreateTable
CREATE TABLE "VehicleProfile" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "vanId" TEXT NOT NULL,
    "make" TEXT,
    "model" TEXT,
    "year" INTEGER,
    "color" TEXT,
    "chassisNumber" TEXT,
    "engineNumber" TEXT,
    "fuelType" "VehicleFuelType",
    "transmissionType" TEXT,
    "loadCapacityKg" DOUBLE PRECISION,
    "seatingCapacity" INTEGER,
    "ownershipType" "VehicleOwnershipType",
    "purchaseDate" TIMESTAMP(3),
    "purchaseCost" DOUBLE PRECISION,
    "supplierName" TEXT,
    "operationalStatus" "VehicleOperationalStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentOdometer" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleDocument" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "vanId" TEXT NOT NULL,
    "type" "VehicleDocumentType" NOT NULL,
    "documentNumber" TEXT,
    "issuingAuthority" TEXT,
    "issueDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "fileKey" TEXT,
    "reminderDaysBefore" INTEGER NOT NULL DEFAULT 30,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleDailyCheck" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "vanId" TEXT NOT NULL,
    "dailySheetId" TEXT NOT NULL,
    "checkType" "VehicleCheckType" NOT NULL,
    "odometerReading" INTEGER NOT NULL,
    "odometerPhotoKey" TEXT,
    "fuelGaugeLevel" INTEGER NOT NULL,
    "checklistResults" JSONB NOT NULL,
    "hasCriticalFailure" BOOLEAN NOT NULL DEFAULT false,
    "criticalOverrideNote" TEXT,
    "criticalOverrideById" TEXT,
    "criticalOverrideAt" TIMESTAMP(3),
    "odometerContinuityFlag" BOOLEAN NOT NULL DEFAULT false,
    "continuityNote" TEXT,
    "damageNoted" BOOLEAN NOT NULL DEFAULT false,
    "damageNote" TEXT,
    "damagePhotoKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "note" TEXT,
    "recordedById" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleDailyCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FuelLog" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "vanId" TEXT NOT NULL,
    "dailySheetId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "odometerAtFill" INTEGER NOT NULL,
    "litersFilled" DOUBLE PRECISION NOT NULL,
    "amountPaid" DOUBLE PRECISION NOT NULL,
    "isFullTank" BOOLEAN NOT NULL DEFAULT true,
    "fuelStation" TEXT,
    "receiptPhotoKey" TEXT,
    "notes" TEXT,
    "expenseId" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FuelLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleMaintenanceRule" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "vanId" TEXT NOT NULL,
    "serviceType" "VehicleServiceType" NOT NULL,
    "intervalKm" INTEGER,
    "intervalDays" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleMaintenanceRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleServiceRecord" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "vanId" TEXT NOT NULL,
    "serviceType" "VehicleServiceType" NOT NULL,
    "performedAtOdometer" INTEGER NOT NULL,
    "performedAtDate" TIMESTAMP(3) NOT NULL,
    "cost" DOUBLE PRECISION NOT NULL,
    "workshopName" TEXT,
    "invoicePhotoKey" TEXT,
    "partsReplaced" TEXT,
    "notes" TEXT,
    "expenseId" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleServiceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VehicleProfile_vanId_key" ON "VehicleProfile"("vanId");

-- CreateIndex
CREATE INDEX "VehicleProfile_vendorId_idx" ON "VehicleProfile"("vendorId");

-- CreateIndex
CREATE INDEX "VehicleDocument_vendorId_vanId_idx" ON "VehicleDocument"("vendorId", "vanId");

-- CreateIndex
CREATE INDEX "VehicleDocument_vendorId_isActive_expiryDate_idx" ON "VehicleDocument"("vendorId", "isActive", "expiryDate");

-- CreateIndex
CREATE INDEX "VehicleDailyCheck_vendorId_vanId_recordedAt_idx" ON "VehicleDailyCheck"("vendorId", "vanId", "recordedAt");

-- CreateIndex
CREATE INDEX "VehicleDailyCheck_dailySheetId_idx" ON "VehicleDailyCheck"("dailySheetId");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleDailyCheck_dailySheetId_checkType_key" ON "VehicleDailyCheck"("dailySheetId", "checkType");

-- CreateIndex
CREATE UNIQUE INDEX "FuelLog_expenseId_key" ON "FuelLog"("expenseId");

-- CreateIndex
CREATE INDEX "FuelLog_vendorId_vanId_date_idx" ON "FuelLog"("vendorId", "vanId", "date");

-- CreateIndex
CREATE INDEX "FuelLog_dailySheetId_idx" ON "FuelLog"("dailySheetId");

-- CreateIndex
CREATE INDEX "VehicleMaintenanceRule_vendorId_vanId_idx" ON "VehicleMaintenanceRule"("vendorId", "vanId");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleMaintenanceRule_vanId_serviceType_key" ON "VehicleMaintenanceRule"("vanId", "serviceType");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleServiceRecord_expenseId_key" ON "VehicleServiceRecord"("expenseId");

-- CreateIndex
CREATE INDEX "VehicleServiceRecord_vendorId_vanId_serviceType_idx" ON "VehicleServiceRecord"("vendorId", "vanId", "serviceType");

-- CreateIndex
CREATE INDEX "VehicleServiceRecord_vendorId_performedAtDate_idx" ON "VehicleServiceRecord"("vendorId", "performedAtDate");

-- AddForeignKey
ALTER TABLE "VehicleProfile" ADD CONSTRAINT "VehicleProfile_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleProfile" ADD CONSTRAINT "VehicleProfile_vanId_fkey" FOREIGN KEY ("vanId") REFERENCES "Van"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleDocument" ADD CONSTRAINT "VehicleDocument_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleDocument" ADD CONSTRAINT "VehicleDocument_vanId_fkey" FOREIGN KEY ("vanId") REFERENCES "Van"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleDocument" ADD CONSTRAINT "VehicleDocument_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleDailyCheck" ADD CONSTRAINT "VehicleDailyCheck_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleDailyCheck" ADD CONSTRAINT "VehicleDailyCheck_vanId_fkey" FOREIGN KEY ("vanId") REFERENCES "Van"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleDailyCheck" ADD CONSTRAINT "VehicleDailyCheck_dailySheetId_fkey" FOREIGN KEY ("dailySheetId") REFERENCES "DailySheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleDailyCheck" ADD CONSTRAINT "VehicleDailyCheck_criticalOverrideById_fkey" FOREIGN KEY ("criticalOverrideById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleDailyCheck" ADD CONSTRAINT "VehicleDailyCheck_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelLog" ADD CONSTRAINT "FuelLog_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelLog" ADD CONSTRAINT "FuelLog_vanId_fkey" FOREIGN KEY ("vanId") REFERENCES "Van"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelLog" ADD CONSTRAINT "FuelLog_dailySheetId_fkey" FOREIGN KEY ("dailySheetId") REFERENCES "DailySheet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelLog" ADD CONSTRAINT "FuelLog_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelLog" ADD CONSTRAINT "FuelLog_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleMaintenanceRule" ADD CONSTRAINT "VehicleMaintenanceRule_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleMaintenanceRule" ADD CONSTRAINT "VehicleMaintenanceRule_vanId_fkey" FOREIGN KEY ("vanId") REFERENCES "Van"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleServiceRecord" ADD CONSTRAINT "VehicleServiceRecord_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleServiceRecord" ADD CONSTRAINT "VehicleServiceRecord_vanId_fkey" FOREIGN KEY ("vanId") REFERENCES "Van"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleServiceRecord" ADD CONSTRAINT "VehicleServiceRecord_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleServiceRecord" ADD CONSTRAINT "VehicleServiceRecord_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
