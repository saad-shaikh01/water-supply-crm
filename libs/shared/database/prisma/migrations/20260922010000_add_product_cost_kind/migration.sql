-- Caps as a separate cost stream (owner request 2026-09-22).
--
-- Caps are purchased separately from the plant's bottle-refill cost, on their
-- own payment, and the business wants COGS to report bottle cost and cap
-- cost apart per bottle sold, not blended into one number. Rather than a new
-- table, `ProductCost` gains a `kind` discriminator (`BOTTLE` | `CAP`) so the
-- existing versioned/effective-dated/backdate-correction machinery (Add,
-- Void, Controlled Edit — product-cost.service.ts) is reused unchanged for
-- both cost streams; each (vendor, product, kind) now has its own
-- independent timeline.
--
-- Purely additive, zero data loss: `kind` defaults to `BOTTLE`, so every
-- existing row (all of which predate this column and are, semantically,
-- already the plant's bottle cost) is reinterpreted as exactly what it
-- already was. No existing row's costPerUnit/effectiveFrom/effectiveTo/
-- history is touched.

-- CreateEnum
CREATE TYPE "ProductCostKind" AS ENUM ('BOTTLE', 'CAP');

-- AlterTable
ALTER TABLE "ProductCost" ADD COLUMN "kind" "ProductCostKind" NOT NULL DEFAULT 'BOTTLE';

-- DropIndex (old effectiveFrom-only uniqueness, superseded by the kind-scoped one below)
DROP INDEX "ProductCost_vendorId_productId_effectiveFrom_key";

-- DropIndex (old lookup index, superseded by the kind-scoped one below)
DROP INDEX "ProductCost_vendorId_productId_effectiveFrom_idx";

-- CreateIndex
CREATE INDEX "ProductCost_vendorId_productId_kind_effectiveFrom_idx" ON "ProductCost"("vendorId", "productId", "kind", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCost_vendorId_productId_kind_effectiveFrom_key" ON "ProductCost"("vendorId", "productId", "kind", "effectiveFrom");
