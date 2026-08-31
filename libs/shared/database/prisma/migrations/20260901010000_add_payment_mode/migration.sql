-- Payment method tracking for manually recorded payments. Purely additive,
-- production-safe.
--
-- The dashboard "Record Payment" dialog now captures HOW the money arrived —
-- cash, cheque, or bank transfer / online. Stored on the PAYMENT transaction
-- row itself. Historical payments and delivery-collected cash stay NULL
-- (unknown) rather than being back-filled to a guessed value.

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('CASH', 'CHEQUE', 'BANK_TRANSFER');

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "paymentMode" "PaymentMode";

-- CreateIndex
CREATE INDEX "Transaction_vendorId_type_paymentMode_idx" ON "Transaction"("vendorId", "type", "paymentMode");
