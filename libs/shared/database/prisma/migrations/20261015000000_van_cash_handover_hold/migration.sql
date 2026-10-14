-- A handover an approver short-approved (approved less than handed over) is put ON HOLD instead of posting:
-- it stays PENDING and carries the proposed amount + reason until an approve_shortfall holder releases it.
-- Additive: every existing row has no hold.
ALTER TABLE "VanCashHandover" ADD COLUMN "heldAmount" DOUBLE PRECISION,
ADD COLUMN "heldReason" TEXT,
ADD COLUMN "heldAt" TIMESTAMP(3),
ADD COLUMN "heldById" TEXT;

ALTER TABLE "VanCashHandover" ADD CONSTRAINT "VanCashHandover_heldById_fkey" FOREIGN KEY ("heldById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
