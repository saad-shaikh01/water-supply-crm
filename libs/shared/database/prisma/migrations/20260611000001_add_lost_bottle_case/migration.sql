-- CreateEnum
CREATE TYPE "DamageCaseType" AS ENUM ('DAMAGE', 'LOST');

-- CreateEnum
CREATE TYPE "BottleLossReason" AS ENUM ('CUSTOMER_NOT_RETURNED', 'CUSTOMER_SAID_LOST', 'WRONG_ADDRESS', 'OTHER');

-- AlterTable: add caseType column (NOT NULL with default DAMAGE for existing rows)
ALTER TABLE "DamageCase" ADD COLUMN "caseType" "DamageCaseType" NOT NULL DEFAULT 'DAMAGE';

-- AlterTable: add lossReason column (nullable)
ALTER TABLE "DamageCase" ADD COLUMN "lossReason" "BottleLossReason";

-- AlterTable: make severity nullable (existing rows keep their existing severity values)
ALTER TABLE "DamageCase" ALTER COLUMN "severity" DROP NOT NULL;
