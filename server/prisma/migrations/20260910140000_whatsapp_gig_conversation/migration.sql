-- AlterTable
ALTER TABLE "WhatsAppSession" ADD COLUMN     "conversationState" TEXT NOT NULL DEFAULT 'idle',
ADD COLUMN     "draftBountyKobo" BIGINT,
ADD COLUMN     "draftDescription" TEXT,
ADD COLUMN     "draftLocationText" TEXT,
ADD COLUMN     "draftSubmarketId" TEXT;
