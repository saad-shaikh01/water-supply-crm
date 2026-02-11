-- CreateIndex
CREATE INDEX "Customer_vendorId_idx" ON "Customer"("vendorId");

-- CreateIndex
CREATE INDEX "Customer_vendorId_routeId_idx" ON "Customer"("vendorId", "routeId");

-- CreateIndex
CREATE INDEX "Customer_routeId_idx" ON "Customer"("routeId");

-- CreateIndex
CREATE INDEX "DailySheet_vendorId_date_idx" ON "DailySheet"("vendorId", "date");

-- CreateIndex
CREATE INDEX "DailySheet_vendorId_routeId_date_idx" ON "DailySheet"("vendorId", "routeId", "date");

-- CreateIndex
CREATE INDEX "DailySheet_driverId_date_idx" ON "DailySheet"("driverId", "date");

-- CreateIndex
CREATE INDEX "DailySheetItem_dailySheetId_sequence_idx" ON "DailySheetItem"("dailySheetId", "sequence");

-- CreateIndex
CREATE INDEX "DailySheetItem_dailySheetId_customerId_idx" ON "DailySheetItem"("dailySheetId", "customerId");

-- CreateIndex
CREATE INDEX "Product_vendorId_isActive_idx" ON "Product"("vendorId", "isActive");

-- CreateIndex
CREATE INDEX "Route_vendorId_idx" ON "Route"("vendorId");

-- CreateIndex
CREATE INDEX "Transaction_vendorId_createdAt_idx" ON "Transaction"("vendorId", "createdAt");

-- CreateIndex
CREATE INDEX "Transaction_customerId_createdAt_idx" ON "Transaction"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "Transaction_dailySheetId_idx" ON "Transaction"("dailySheetId");

-- CreateIndex
CREATE INDEX "User_vendorId_idx" ON "User"("vendorId");
