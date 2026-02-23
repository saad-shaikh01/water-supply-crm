-- DropForeignKey
ALTER TABLE "DailySheet" DROP CONSTRAINT "DailySheet_routeId_fkey";

-- AddForeignKey
ALTER TABLE "DailySheet" ADD CONSTRAINT "DailySheet_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE SET NULL ON UPDATE CASCADE;
