-- Rename enum value EXTRA_LOADER to EXTRA_LABOUR in ExpenseCategory enum
-- Hand-written migration to preserve existing data without table recreate
ALTER TYPE "ExpenseCategory" RENAME VALUE 'EXTRA_LOADER' TO 'EXTRA_LABOUR';
