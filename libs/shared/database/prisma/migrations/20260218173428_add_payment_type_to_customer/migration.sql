-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('MONTHLY', 'CASH');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "paymentType" "PaymentType" NOT NULL DEFAULT 'CASH';
