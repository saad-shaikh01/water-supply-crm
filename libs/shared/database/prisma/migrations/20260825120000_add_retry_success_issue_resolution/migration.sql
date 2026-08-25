-- Additive only — no existing rows/values touched.
-- Delivery Issues Phase 5 (retry-completion auto-close): a new IssueResolution
-- value distinguishing an issue that was auto-resolved because its retried
-- delivery completed successfully, from a manually-picked resolution in the
-- Resolve dialog (DELIVERED / SELF_PICKUP_DONE / DROPPED / CANCELLED).

-- AlterEnum
ALTER TYPE "IssueResolution" ADD VALUE 'RETRY_SUCCESS';
