-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('new', 'contacted', 'converted', 'closed');

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "waProfileName" TEXT,
    "message" TEXT NOT NULL,
    "submarketGuess" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'new',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Lead_status_createdAt_idx" ON "Lead"("status", "createdAt");
