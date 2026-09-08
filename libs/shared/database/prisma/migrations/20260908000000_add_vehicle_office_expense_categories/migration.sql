-- Additive only — no existing rows/values touched. Adds six new selectable
-- expense categories (owner request 2026-09-08): a VEHICLE checkpoint cost
-- (POLICE), three OFFICE overhead/regulatory categories (MOBILE_LOAD, PSQCA,
-- CHARITY), an INVENTORY repair category (BOTTLE_REPAIR), and an EMPLOYEES
-- payout category (CONTRACTOR_PAYMENT).

-- AlterEnum
ALTER TYPE "ExpenseCategory" ADD VALUE 'POLICE';
ALTER TYPE "ExpenseCategory" ADD VALUE 'MOBILE_LOAD';
ALTER TYPE "ExpenseCategory" ADD VALUE 'PSQCA';
ALTER TYPE "ExpenseCategory" ADD VALUE 'BOTTLE_REPAIR';
ALTER TYPE "ExpenseCategory" ADD VALUE 'CONTRACTOR_PAYMENT';
ALTER TYPE "ExpenseCategory" ADD VALUE 'CHARITY';
