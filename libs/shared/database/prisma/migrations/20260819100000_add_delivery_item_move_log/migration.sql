-- Customer Move/Transfer footprint. moveDeliveryItems() already wrote an
-- AuditLog(action='CUSTOMER_DELIVERY_MOVED') entry per move, but it's buried
-- in JSON with no queryable/indexed path from either the source or the
-- destination sheet. This table gives both sides a direct, indexed list —
-- one row per hop, keyed by the same DailySheetItem.id across multiple
-- moves, so A -> B -> C lineage is just multiple rows for one itemId.
-- fromSheet/toSheet already carry van + date via DailySheet.van/date, so
-- those are read through the relation instead of being re-denormalized here.

CREATE TABLE "DeliveryItemMoveLog" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "fromSheetId" TEXT NOT NULL,
    "toSheetId" TEXT NOT NULL,
    "movedById" TEXT NOT NULL,
    "movedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryItemMoveLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeliveryItemMoveLog_fromSheetId_idx" ON "DeliveryItemMoveLog"("fromSheetId");

-- CreateIndex
CREATE INDEX "DeliveryItemMoveLog_toSheetId_idx" ON "DeliveryItemMoveLog"("toSheetId");

-- CreateIndex
CREATE INDEX "DeliveryItemMoveLog_itemId_idx" ON "DeliveryItemMoveLog"("itemId");

-- CreateIndex
CREATE INDEX "DeliveryItemMoveLog_vendorId_movedAt_idx" ON "DeliveryItemMoveLog"("vendorId", "movedAt");

-- AddForeignKey
ALTER TABLE "DeliveryItemMoveLog" ADD CONSTRAINT "DeliveryItemMoveLog_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryItemMoveLog" ADD CONSTRAINT "DeliveryItemMoveLog_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "DailySheetItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryItemMoveLog" ADD CONSTRAINT "DeliveryItemMoveLog_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryItemMoveLog" ADD CONSTRAINT "DeliveryItemMoveLog_fromSheetId_fkey" FOREIGN KEY ("fromSheetId") REFERENCES "DailySheet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryItemMoveLog" ADD CONSTRAINT "DeliveryItemMoveLog_toSheetId_fkey" FOREIGN KEY ("toSheetId") REFERENCES "DailySheet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryItemMoveLog" ADD CONSTRAINT "DeliveryItemMoveLog_movedById_fkey" FOREIGN KEY ("movedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
