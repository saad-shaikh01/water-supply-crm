-- Additive only — no existing rows/values touched. Adds six new selectable
-- expense categories (owner request 2026-09-07): three OFFICE overhead
-- categories (RENT, UTILITIES, STATIONARY) and three INVENTORY procurement
-- categories (BOTTLE_PURCHASED, CAPS_PURCHASED, CHEMICALS_PURCHASED).

-- AlterEnum
ALTER TYPE "ExpenseCategory" ADD VALUE 'RENT';
ALTER TYPE "ExpenseCategory" ADD VALUE 'UTILITIES';
ALTER TYPE "ExpenseCategory" ADD VALUE 'STATIONARY';
ALTER TYPE "ExpenseCategory" ADD VALUE 'BOTTLE_PURCHASED';
ALTER TYPE "ExpenseCategory" ADD VALUE 'CAPS_PURCHASED';
ALTER TYPE "ExpenseCategory" ADD VALUE 'CHEMICALS_PURCHASED';
