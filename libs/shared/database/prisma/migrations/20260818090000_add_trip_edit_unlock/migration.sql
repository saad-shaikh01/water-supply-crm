-- Trip Edit-Unlock: ports the existing DailySheetItem edit-lock pattern to
-- DailySheetLoad (trips). A checked-in trip's numbers are otherwise
-- permanently locked (checkinLoad() rejects a second call outright) — this
-- lets a driver request an edit, staff/admin grant a time-boxed unlock
-- window, and the driver re-submit checkinLoad with forceResubmit=true
-- within that window (same field names/semantics as DailySheetItem's
-- editUnlockedBy/editUnlockExpiresAt/editRequestedAt/editCount/lastEditedAt).

ALTER TABLE "DailySheetLoad" ADD COLUMN "editUnlockedBy" TEXT;
ALTER TABLE "DailySheetLoad" ADD COLUMN "editUnlockExpiresAt" TIMESTAMP(3);
ALTER TABLE "DailySheetLoad" ADD COLUMN "editRequestedAt" TIMESTAMP(3);
ALTER TABLE "DailySheetLoad" ADD COLUMN "editCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DailySheetLoad" ADD COLUMN "lastEditedAt" TIMESTAMP(3);

-- Dedicated ledger type for a trip-edit correction (signed delta applied to
-- WarehouseStock via WarehouseService.recordCheckinCorrection) — keeps the
-- warehouse transaction log's `type` column self-explanatory, matching the
-- existing one-value-per-source convention (LOAD_OUT, CHECK_IN_FILLED, etc.)
-- rather than folding it into the generic ADJUSTMENT value.
ALTER TYPE "WarehouseTransactionType" ADD VALUE 'TRIP_EDIT_CORRECTION';
