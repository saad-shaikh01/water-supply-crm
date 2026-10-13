-- A salary-slip delivery now records WHICH document it sent (full slip or compact receipt), so one employee can
-- get both as two rows. Additive: every existing row is a full slip.
CREATE TYPE "PayrollSlipDocumentKind" AS ENUM ('SLIP', 'RECEIPT');

ALTER TABLE "PayrollSlipDelivery" ADD COLUMN "documentKind" "PayrollSlipDocumentKind" NOT NULL DEFAULT 'SLIP';
