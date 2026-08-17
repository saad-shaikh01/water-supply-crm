-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "paidFromCash" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "FuelLog" ADD COLUMN     "paidFromCash" BOOLEAN NOT NULL DEFAULT true;
