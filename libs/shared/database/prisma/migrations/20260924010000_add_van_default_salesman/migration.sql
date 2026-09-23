-- Van "default salesman" priority slot (owner decision: a van's salesman
-- should take priority over its driver when generating/creating a daily
-- sheet — Van.defaultDriverId stays as the fallback when no default
-- salesman is assigned). Purely additive: nullable column, no backfill, no
-- existing data touched or lost.
ALTER TABLE "Van" ADD COLUMN "defaultSalesmanId" TEXT;

CREATE UNIQUE INDEX "Van_defaultSalesmanId_key" ON "Van" ("defaultSalesmanId");

ALTER TABLE "Van" ADD CONSTRAINT "Van_defaultSalesmanId_fkey"
  FOREIGN KEY ("defaultSalesmanId") REFERENCES "User" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
