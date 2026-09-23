-- Fix: voiding a ProductCost row never freed up its effectiveFrom date for
-- reuse. The unique constraint (vendorId, productId, kind, effectiveFrom)
-- applied to ALL rows, including voided ones (void is a soft-delete — the
-- row is kept, never removed, for audit continuity). So the documented
-- recovery flow — void the current row, then re-add a corrected cost at the
-- same effective date — hit a P2002 unique-constraint violation on the
-- re-add, surfacing as a 500.
--
-- Replace the unconditional unique index with a partial one that only
-- applies to active (non-voided) rows, so a voided row no longer blocks a
-- new row at the same effective date.
DROP INDEX "ProductCost_vendorId_productId_kind_effectiveFrom_key";

CREATE UNIQUE INDEX "ProductCost_vendorId_productId_kind_effectiveFrom_active_key"
  ON "ProductCost" ("vendorId", "productId", "kind", "effectiveFrom")
  WHERE "voidedAt" IS NULL;
