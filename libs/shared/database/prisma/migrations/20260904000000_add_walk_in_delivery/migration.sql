-- Walk-in / Self-Pickup Delivery (docs/features/walk-in-delivery.md).
--
-- A lightweight "Record Delivery" action, parallel to "Record Payment", for a
-- delivery that happened off the route pipeline (customer self-collected, or it
-- went through some other channel). Each such delivery is recorded as a real
-- DailySheetItem on a synthetic DailySheet of kind = WALK_IN — one per vendor
-- per calendar date, lazily created on first use, owned by a per-vendor sentinel
-- van + sentinel "counter" user (Van.isSystem / User.isSystem). The WALK_IN
-- sheet is created crewConfirmed = true and is skipped by auto-generation, crew
-- confirmation, load-out / trips, van-cash reconciliation and per-van analytics.
--
-- Purely additive: new columns are nullable or carry a DEFAULT, and the two new
-- enums are not referenced by any data update here, so the whole migration is
-- safe to run in one transaction against a live database.

-- CreateEnum
CREATE TYPE "DailySheetKind" AS ENUM ('ROUTE', 'WALK_IN');

-- CreateEnum
CREATE TYPE "DeliveryChannel" AS ENUM ('SELF_PICKUP', 'THIRD_PARTY', 'OTHER');

-- AlterTable
ALTER TABLE "DailySheet" ADD COLUMN "kind" "DailySheetKind" NOT NULL DEFAULT 'ROUTE';

-- AlterTable
ALTER TABLE "DailySheetItem" ADD COLUMN "deliveryChannel" "DeliveryChannel";

-- AlterTable
ALTER TABLE "Van" ADD COLUMN "isSystem" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "isSystem" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "DailySheet_vendorId_kind_date_idx" ON "DailySheet"("vendorId", "kind", "date");
