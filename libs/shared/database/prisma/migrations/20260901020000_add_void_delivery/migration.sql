-- Void Delivery. A recorded stop can be struck from the operational record by a
-- holder of the new daily_sheets:void_delivery permission (Admin + Manager).
--
-- For a pre-void status of COMPLETED / EMPTY_ONLY the ledger effect is reversed
-- via the existing idempotent all-zero repost (LedgerService.recordDelivery);
-- for NOT_AVAILABLE / RESCHEDULED / CANCELLED it is an operational hide with an
-- audit entry only (no ledger call). PENDING is not voidable.
--
-- Who / when / why live on the item (voidedAt / voidedById / voidReason /
-- voidNote) plus an AuditLog row (action DELIVERY_VOIDED, before/after). Purely
-- additive; the new enum value is not referenced by any data update here, so the
-- ALTER TYPE is safe to run in the same migration transaction.

-- AlterEnum
ALTER TYPE "DeliveryStatus" ADD VALUE 'VOIDED';

-- CreateEnum
CREATE TYPE "DeliveryVoidReason" AS ENUM ('DUPLICATE', 'WRONG_SHEET', 'WRONG_DATE', 'NEVER_HAPPENED', 'DATA_ENTRY_ERROR', 'OTHER');

-- AlterTable
ALTER TABLE "DailySheetItem" ADD COLUMN "voidedAt" TIMESTAMP(3);
ALTER TABLE "DailySheetItem" ADD COLUMN "voidedById" TEXT;
ALTER TABLE "DailySheetItem" ADD COLUMN "voidReason" "DeliveryVoidReason";
ALTER TABLE "DailySheetItem" ADD COLUMN "voidNote" TEXT;

-- AddForeignKey
ALTER TABLE "DailySheetItem" ADD CONSTRAINT "DailySheetItem_voidedById_fkey"
  FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
