-- Staff Attendance & Wage Types — Phase 3 (docs/features/staff-attendance-and-wage-types.md).
--
-- Adds WEEKLY and DAILY to PayFrequency. Enum-value additions ONLY — nothing
-- else in this file, per §6.3 C2: Postgres cannot use a new enum value inside
-- the same transaction that adds it (no column default, no data UPDATE, no
-- CHECK constraint referencing it may share this migration). The application
-- change that starts reading these values (PayrollEntryService.resolvePeriodBase)
-- ships in the same release, but as separate, already-compiled code — not SQL —
-- so this file is safe to run standalone, before or after that deploy.
--
-- No dailyRate column, no new table: SalaryStructure.baseAmount is reinterpreted
-- by frequency (see the schema comment above `enum PayFrequency`).

-- AlterEnum
ALTER TYPE "PayFrequency" ADD VALUE 'WEEKLY';

-- AlterEnum
ALTER TYPE "PayFrequency" ADD VALUE 'DAILY';
