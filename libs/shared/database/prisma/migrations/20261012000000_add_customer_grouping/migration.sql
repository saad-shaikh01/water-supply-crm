-- Optional customer grouping (Group -> SubGroup). Additive only; every existing vendor/customer is unaffected
-- (flag defaults to false, group columns are NULL).
ALTER TABLE "Vendor" ADD COLUMN "customerGroupingEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "CustomerGroup" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomerGroup_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomerGroup_vendorId_parentId_idx" ON "CustomerGroup"("vendorId", "parentId");

ALTER TABLE "CustomerGroup" ADD CONSTRAINT "CustomerGroup_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerGroup" ADD CONSTRAINT "CustomerGroup_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CustomerGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Customer" ADD COLUMN "groupId" TEXT;
ALTER TABLE "Customer" ADD COLUMN "subGroupId" TEXT;
CREATE INDEX "Customer_vendorId_groupId_subGroupId_idx" ON "Customer"("vendorId", "groupId", "subGroupId");
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CustomerGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_subGroupId_fkey" FOREIGN KEY ("subGroupId") REFERENCES "CustomerGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
