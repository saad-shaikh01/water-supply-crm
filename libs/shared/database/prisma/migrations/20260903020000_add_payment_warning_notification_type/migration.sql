-- Phase 2 (Overdue Warning): independent vendor master switch for the warning flow,
-- separate from MONTHLY_STATEMENT so a vendor can send statements but not warnings.
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_WARNING';
