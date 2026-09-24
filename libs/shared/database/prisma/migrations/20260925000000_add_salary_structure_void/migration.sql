-- Salary Structure Void (owner-requested 2026-09-25) — mirrors ProductCost's
-- void pattern: a data-entry mistake (wrong amount or wrong effective date) can
-- now be corrected without ever editing a row in place. Only the current/latest,
-- non-voided row may be voided; the predecessor it had trimmed (if any) is
-- reopened. Voided rows are never deleted — they stay visible in the Salary
-- History timeline for the audit trail, struck through.
--
-- Purely additive: three new nullable columns + one new FK. No existing column
-- altered, no data backfill.

-- AlterTable
ALTER TABLE "SalaryStructure" ADD COLUMN "voidedAt" TIMESTAMP(3),
ADD COLUMN "voidedById" TEXT,
ADD COLUMN "voidReason" TEXT;

-- AddForeignKey
ALTER TABLE "SalaryStructure" ADD CONSTRAINT "SalaryStructure_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
