-- Phase 2 (Overdue Warning): extend ReminderSendKind with WARNING.
-- Standalone ADD VALUE — not referenced by any table alteration here.
ALTER TYPE "ReminderSendKind" ADD VALUE 'WARNING';
