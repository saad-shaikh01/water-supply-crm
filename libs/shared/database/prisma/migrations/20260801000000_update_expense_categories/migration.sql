-- Replace ExpenseCategory enum values with client-requested categories.
-- Mapping for existing rows: FUEL -> FUEL_EXPENSE, MAINTENANCE -> VEHICLE_MAINTENANCE,
-- REPAIR -> VEHICLE_MAINTENANCE (no direct equivalent in new list), SALARY -> ADVANCE_SALARY_EMPLOYEE,
-- OTHER -> OTHER.

CREATE TYPE "ExpenseCategory_new" AS ENUM ('LUNCH_EXPENSE_EMPLOYEE', 'ADVANCE_SALARY_EMPLOYEE', 'VEHICLE_MAINTENANCE', 'FUEL_EXPENSE', 'OTHER');

ALTER TABLE "Expense" ALTER COLUMN "category" TYPE "ExpenseCategory_new" USING (
  CASE "category"::text
    WHEN 'FUEL' THEN 'FUEL_EXPENSE'
    WHEN 'MAINTENANCE' THEN 'VEHICLE_MAINTENANCE'
    WHEN 'REPAIR' THEN 'VEHICLE_MAINTENANCE'
    WHEN 'SALARY' THEN 'ADVANCE_SALARY_EMPLOYEE'
    ELSE 'OTHER'
  END::"ExpenseCategory_new"
);

DROP TYPE "ExpenseCategory";
ALTER TYPE "ExpenseCategory_new" RENAME TO "ExpenseCategory";
