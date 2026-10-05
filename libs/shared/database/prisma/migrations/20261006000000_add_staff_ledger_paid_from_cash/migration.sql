-- Cash vs. bank/online for staff advances. Default true keeps every existing row
-- counted as office cash out, exactly as before.
ALTER TABLE "StaffLedgerEntry" ADD COLUMN "paidFromCash" BOOLEAN NOT NULL DEFAULT true;
