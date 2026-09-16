-- Additive only — no existing rows/values touched. Splits BOTTLE_PURCHASED
-- (owner request 2026-09-17): that category had been used for both "buying
-- new empty bottles" and "paying the plant to refill bottles with water" —
-- two financially distinct things. BOTTLE_REFILL_PAYMENT is the new,
-- accurately-named category for the latter (plant refill payments); existing
-- BOTTLE_PURCHASED rows are left untouched.

-- AlterEnum
ALTER TYPE "ExpenseCategory" ADD VALUE 'BOTTLE_REFILL_PAYMENT';
