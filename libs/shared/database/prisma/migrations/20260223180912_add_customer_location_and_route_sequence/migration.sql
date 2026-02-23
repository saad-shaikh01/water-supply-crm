-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "deliveryInstructions" TEXT,
ADD COLUMN     "floor" TEXT,
ADD COLUMN     "googleMapsUrl" TEXT,
ADD COLUMN     "nearbyLandmark" TEXT,
ADD COLUMN     "routeSequence" INTEGER;

-- CreateIndex
CREATE INDEX "Customer_routeId_routeSequence_idx" ON "Customer"("routeId", "routeSequence");
