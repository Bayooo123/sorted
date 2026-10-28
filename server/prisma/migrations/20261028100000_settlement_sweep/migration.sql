-- PLAN.md "Settlement sweep"

-- AlterTable: tag which provider each Enough account's deposits land on.
ALTER TABLE "EnoughAccount" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'bachs';

-- CreateEnum
CREATE TYPE "SettlementSweepStatus" AS ENUM ('completed', 'failed');

-- CreateTable
CREATE TABLE "SettlementSweep" (
  "id" TEXT NOT NULL,
  "fromProvider" TEXT NOT NULL,
  "toProvider" TEXT NOT NULL,
  "amountKobo" BIGINT NOT NULL,
  "accountsSwept" INTEGER NOT NULL,
  "status" "SettlementSweepStatus" NOT NULL,
  "failureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SettlementSweep_pkey" PRIMARY KEY ("id")
);
