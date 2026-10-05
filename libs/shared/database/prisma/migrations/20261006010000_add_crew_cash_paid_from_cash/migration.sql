-- Cash vs. bank/online for sheet crew cash. Default true keeps every existing row
-- deducted from the sheet's hand-in, exactly as before.
ALTER TABLE "CrewCashDistribution" ADD COLUMN "paidFromCash" BOOLEAN NOT NULL DEFAULT true;
