-- Additive only — no existing rows/values touched. Adds two new selectable
-- expense categories (owner request 2026-08-21): ICE_PURCHASED, EXTRA_LOADER.
-- LUNCH_EXPENSE_EMPLOYEE/ADVANCE_SALARY_EMPLOYEE/FUEL_EXPENSE stay in the enum
-- (existing Expense rows + historical PDF exports still reference them) but
-- are dropped from the "add expense" dropdown at the application layer.

-- AlterEnum
ALTER TYPE "ExpenseCategory" ADD VALUE 'ICE_PURCHASED';
ALTER TYPE "ExpenseCategory" ADD VALUE 'EXTRA_LOADER';
