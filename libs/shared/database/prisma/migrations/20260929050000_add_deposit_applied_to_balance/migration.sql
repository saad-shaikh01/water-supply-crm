-- Customer Deposits — Closure Settlement (owner-requested 2026-09-29): a new
-- DepositEntryDirection value so a CASH deposit can be returned to the
-- customer as a CREDIT against Customer.financialBalance instead of physical
-- cash (CustomerDepositsService.applyToBalance) — no Cash Ledger movement,
-- distinct from the existing WRITE_OFF (a company loss).
--
-- PURELY ADDITIVE: one new enum value. No existing row is read or rewritten.

-- AlterEnum
ALTER TYPE "DepositEntryDirection" ADD VALUE 'APPLIED_TO_BALANCE';
