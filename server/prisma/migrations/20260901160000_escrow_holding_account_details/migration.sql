-- AlterTable
ALTER TABLE "EscrowRecord" ADD COLUMN     "holdingAccountDetails" JSONB,
ALTER COLUMN "provider" SET DEFAULT 'manual_pilot';
