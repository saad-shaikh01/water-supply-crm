-- CreateTable
CREATE TABLE "ExtraLabourType" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExtraLabourType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtraLabour" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phoneNumber" TEXT,
    "labourTypeId" TEXT NOT NULL,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExtraLabour_pkey" PRIMARY KEY ("id")
);

-- AddColumn
ALTER TABLE "Expense" ADD COLUMN "extraLabourId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ExtraLabourType_vendorId_name_key" ON "ExtraLabourType"("vendorId", "name");

-- CreateIndex
CREATE INDEX "ExtraLabour_vendorId_isActive_idx" ON "ExtraLabour"("vendorId", "isActive");

-- CreateIndex
CREATE INDEX "Expense_extraLabourId_date_idx" ON "Expense"("extraLabourId", "date");

-- AddForeignKey
ALTER TABLE "ExtraLabourType" ADD CONSTRAINT "ExtraLabourType_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtraLabour" ADD CONSTRAINT "ExtraLabour_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtraLabour" ADD CONSTRAINT "ExtraLabour_labourTypeId_fkey" FOREIGN KEY ("labourTypeId") REFERENCES "ExtraLabourType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtraLabour" ADD CONSTRAINT "ExtraLabour_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_extraLabourId_fkey" FOREIGN KEY ("extraLabourId") REFERENCES "ExtraLabour"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- Seed default labour types for every existing vendor
INSERT INTO "ExtraLabourType" ("id", "vendorId", "name", "isSystem", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, v.id, t.name, t.is_system, NOW(), NOW()
FROM "Vendor" v
CROSS JOIN (VALUES
  ('Loader',   false),
  ('Helper',   false),
  ('Driver',   false),
  ('Mechanic', false),
  ('Cleaner',  false),
  ('Other',    true)
) AS t(name, is_system);
