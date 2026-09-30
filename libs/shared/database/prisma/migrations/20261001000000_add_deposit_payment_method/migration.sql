-- Customer Deposits — payment method (owner-requested 2026-10-01).
-- Until now every CASH-type deposit entry was treated as physical cash in the
-- office box, so a bank-transfer / online deposit wrongly inflated Office
-- Available Cash. Each entry now records how the money moved; only
-- paymentMethod = CASH entries are Cash Ledger movements.
--
-- PURELY ADDITIVE: a new enum + a NOT NULL column with DEFAULT 'CASH', so every
-- existing entry keeps counting in the Cash Ledger exactly as it did before.

-- CreateEnum
CREATE TYPE "DepositPaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'ONLINE');

-- AlterTable
ALTER TABLE "CustomerDepositEntry" ADD COLUMN "paymentMethod" "DepositPaymentMethod" NOT NULL DEFAULT 'CASH';
