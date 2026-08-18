-- Delivery item edit history: cheap "was this edited" badge on DailySheetItem
-- (bumped alongside the existing DELIVERY_EDIT_OVERRIDE audit log entry in
-- submitDelivery's forceResubmit branch). The actual before/after diffs
-- already exist in AuditLog (entity='DailySheetItem') and are now surfaced
-- per-item via GET /daily-sheets/items/:id/history.

ALTER TABLE "DailySheetItem" ADD COLUMN "editCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DailySheetItem" ADD COLUMN "lastEditedAt" TIMESTAMP(3);
