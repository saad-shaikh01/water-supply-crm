-- Payment edit/delete — Phase 1 (schema only). Purely additive, production-safe.
--
-- New nullable columns on "Transaction" for edit auditing + an optional link
-- back to the "PaymentRequest" a payment transaction was created from.
-- "updatedAt" is a Prisma @updatedAt column (NOT NULL, no model-level default):
-- it is added WITH a temporary DEFAULT CURRENT_TIMESTAMP so existing rows
-- backfill safely, then the default is dropped so the column matches the
-- Prisma datamodel exactly (Prisma manages the value from the client going
-- forward). No data is rewritten and no column is made NOT NULL without a
-- default.

-- CreateEnum
-- Unused by any model field in this phase — reserved for later-phase DTOs.
CREATE TYPE "PaymentEditReason" AS ENUM ('WRONG_AMOUNT', 'CASH_RECOUNTED', 'DUPLICATE_ENTRY', 'WRONG_CUSTOMER', 'CUSTOMER_REQUESTED', 'OTHER');

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "lastEditedAt" TIMESTAMP(3),
ADD COLUMN     "lastEditedById" TEXT,
ADD COLUMN     "paymentRequestId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Drop the temporary default now that existing rows are backfilled; the
-- Prisma client supplies "updatedAt" on every write from here on.
ALTER TABLE "Transaction" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "Transaction_paymentRequestId_idx" ON "Transaction"("paymentRequestId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_paymentRequestId_fkey" FOREIGN KEY ("paymentRequestId") REFERENCES "PaymentRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
