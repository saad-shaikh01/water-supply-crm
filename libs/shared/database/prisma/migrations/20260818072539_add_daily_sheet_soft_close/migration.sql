-- Soft Close workflow (Amendment R9): Driver/Salesman may close their own
-- sheet (isClosed flips true immediately, same edit-lock as a normal close),
-- but the Crew Cash -> Payroll Ledger sync and Sheet Discrepancy Case
-- creation are deferred until Staff/Admin explicitly approves. Reject reopens
-- the sheet (isClosed=false, closureStatus->REJECTED) so the requester can
-- fix and resubmit. A direct Staff/Admin close (unchanged legacy path) skips
-- the review cycle entirely and lands straight on closureStatus=APPROVED.

CREATE TYPE "DailySheetClosureStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED');

ALTER TABLE "DailySheet" ADD COLUMN "closureStatus" "DailySheetClosureStatus";
ALTER TABLE "DailySheet" ADD COLUMN "closureRequestedAt" TIMESTAMP(3);
ALTER TABLE "DailySheet" ADD COLUMN "closureRequestedById" TEXT;
ALTER TABLE "DailySheet" ADD COLUMN "closureApprovedAt" TIMESTAMP(3);
ALTER TABLE "DailySheet" ADD COLUMN "closureApprovedById" TEXT;
ALTER TABLE "DailySheet" ADD COLUMN "closureRejectedAt" TIMESTAMP(3);
ALTER TABLE "DailySheet" ADD COLUMN "closureRejectedById" TEXT;
ALTER TABLE "DailySheet" ADD COLUMN "closureRejectionReason" TEXT;

ALTER TABLE "DailySheet" ADD CONSTRAINT "DailySheet_closureRequestedById_fkey"
  FOREIGN KEY ("closureRequestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DailySheet" ADD CONSTRAINT "DailySheet_closureApprovedById_fkey"
  FOREIGN KEY ("closureApprovedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DailySheet" ADD CONSTRAINT "DailySheet_closureRejectedById_fkey"
  FOREIGN KEY ("closureRejectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Pre-existing closed sheets predate this feature entirely — leave
-- closureStatus NULL for them (frontend treats NULL + isClosed=true as "the
-- legacy direct close", identical to how it treats a fresh direct close).
