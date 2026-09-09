-- Post-Close Crew Cash Correction (owner request 2026-09-09).
--
-- Adds a single marker column to DailySheet, incremented by every correction
-- applied to a CLOSED sheet's already-synced CrewCashDistribution rows through
-- the /crew-cash/:id/correct endpoint.
--
-- Unlike the Expense sibling, that endpoint DOES rewrite the CrewCash row's own
-- amount / category / employee (and repoints it to a fresh StaffLedgerEntry so
-- the row and its ledger entry never disagree). It still does NOT rewrite the
-- frozen close-time cashExpected / cashCollected columns; this counter lets the
-- post-close divergence banner and the hybrid cash rollups (dashboard /
-- analytics / driver stats) detect that a closed sheet's live crew-cash total
-- no longer matches its snapshot and switch that one sheet to a live recompute.
--
-- Purely additive: NOT NULL with a DEFAULT 0, so it is safe to run in one
-- transaction against a live database.

-- AlterTable
ALTER TABLE "DailySheet" ADD COLUMN "postCloseCrewCashCorrectionCount" INTEGER NOT NULL DEFAULT 0;
