-- AlterTable
ALTER TABLE "Route" ADD COLUMN     "defaultVanId" TEXT;

-- AddForeignKey
ALTER TABLE "Route" ADD CONSTRAINT "Route_defaultVanId_fkey" FOREIGN KEY ("defaultVanId") REFERENCES "Van"("id") ON DELETE SET NULL ON UPDATE CASCADE;
