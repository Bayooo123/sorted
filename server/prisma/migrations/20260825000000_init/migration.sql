-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('unverified', 'pending', 'verified', 'rejected');

-- CreateEnum
CREATE TYPE "GigSource" AS ENUM ('self_posted');

-- CreateEnum
CREATE TYPE "MaterialsMode" AS ENUM ('bounty_covers', 'professional_supplies');

-- CreateEnum
CREATE TYPE "GigStatus" AS ENUM ('draft', 'escrow_pending', 'open', 'claimed', 'in_progress', 'submitted', 'signed_off', 'disputed', 'released', 'refunded', 'cancelled');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('pending', 'active', 'withdrawn', 'completed');

-- CreateEnum
CREATE TYPE "EscrowState" AS ENUM ('awaiting_funding', 'funded', 'stake_held', 'releasing', 'released', 'refunded', 'dispute_hold');

-- CreateEnum
CREATE TYPE "DisputeRuling" AS ENUM ('for_professional', 'for_client', 'split');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('open', 'assigned', 'ruled', 'closed');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('fund', 'stake', 'release', 'refund', 'fee', 'penalty', 'payout');

-- CreateEnum
CREATE TYPE "LedgerDirection" AS ENUM ('in', 'out');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "roleFlags" TEXT[],
    "kycStatus" "KycStatus" NOT NULL DEFAULT 'unverified',
    "identityRef" TEXT,
    "monnifyCustomerRef" TEXT,
    "payoutBankCode" TEXT,
    "payoutAccountNumber" TEXT,
    "payoutAccountName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpRequest" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "salt" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Domain" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "Domain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Submarket" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "domainId" TEXT,

    CONSTRAINT "Submarket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfessionalServiceOffering" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "submarketId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfessionalServiceOffering_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientSeekingCategory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "submarketId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientSeekingCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientTypeRef" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "ClientTypeRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GigTemplate" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "spec" JSONB NOT NULL,
    "recurrence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GigTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Gig" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "source" "GigSource" NOT NULL DEFAULT 'self_posted',
    "templateId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "submarketId" TEXT NOT NULL,
    "clientTypeId" TEXT NOT NULL,
    "locationText" TEXT NOT NULL,
    "locationGeoLat" DOUBLE PRECISION,
    "locationGeoLng" DOUBLE PRECISION,
    "materialsMode" "MaterialsMode" NOT NULL,
    "bountyKobo" BIGINT NOT NULL,
    "status" "GigStatus" NOT NULL DEFAULT 'draft',
    "matchingStrategy" TEXT NOT NULL DEFAULT 'fixed_price_accept',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "Gig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Criterion" (
    "id" TEXT NOT NULL,
    "gigId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "verificationStrategy" TEXT NOT NULL DEFAULT 'client_signoff',
    "proofUrl" TEXT,
    "met" BOOLEAN,

    CONSTRAINT "Criterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "gigId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "staked" BOOLEAN NOT NULL DEFAULT false,
    "status" "ClaimStatus" NOT NULL DEFAULT 'pending',
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscrowRecord" (
    "id" TEXT NOT NULL,
    "gigId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'monnify',
    "holdingAccountRef" TEXT,
    "bountyKobo" BIGINT NOT NULL,
    "stakeKobo" BIGINT NOT NULL DEFAULT 0,
    "stakeHeld" BOOLEAN NOT NULL DEFAULT false,
    "platformFeeBps" INTEGER NOT NULL,
    "feeKobo" BIGINT,
    "professionalPayoutKobo" BIGINT,
    "state" "EscrowState" NOT NULL DEFAULT 'awaiting_funding',
    "disbursementRef" TEXT,
    "stateChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EscrowRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "gigId" TEXT NOT NULL,
    "raisedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "neutralId" TEXT,
    "ruling" "DisputeRuling",
    "penaltyKobo" BIGINT,
    "status" "DisputeStatus" NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "gigId" TEXT NOT NULL,
    "type" "LedgerEntryType" NOT NULL,
    "amountKobo" BIGINT NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "providerRef" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE INDEX "OtpRequest_phone_idx" ON "OtpRequest"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "Domain_key_key" ON "Domain"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Submarket_key_key" ON "Submarket"("key");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalServiceOffering_userId_submarketId_key" ON "ProfessionalServiceOffering"("userId", "submarketId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientSeekingCategory_userId_submarketId_key" ON "ClientSeekingCategory"("userId", "submarketId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientTypeRef_key_key" ON "ClientTypeRef"("key");

-- CreateIndex
CREATE UNIQUE INDEX "EscrowRecord_gigId_key" ON "EscrowRecord"("gigId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_eventId_key" ON "LedgerEntry"("eventId");

-- AddForeignKey
ALTER TABLE "Submarket" ADD CONSTRAINT "Submarket_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalServiceOffering" ADD CONSTRAINT "ProfessionalServiceOffering_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalServiceOffering" ADD CONSTRAINT "ProfessionalServiceOffering_submarketId_fkey" FOREIGN KEY ("submarketId") REFERENCES "Submarket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSeekingCategory" ADD CONSTRAINT "ClientSeekingCategory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSeekingCategory" ADD CONSTRAINT "ClientSeekingCategory_submarketId_fkey" FOREIGN KEY ("submarketId") REFERENCES "Submarket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GigTemplate" ADD CONSTRAINT "GigTemplate_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gig" ADD CONSTRAINT "Gig_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gig" ADD CONSTRAINT "Gig_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "GigTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gig" ADD CONSTRAINT "Gig_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gig" ADD CONSTRAINT "Gig_submarketId_fkey" FOREIGN KEY ("submarketId") REFERENCES "Submarket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gig" ADD CONSTRAINT "Gig_clientTypeId_fkey" FOREIGN KEY ("clientTypeId") REFERENCES "ClientTypeRef"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Criterion" ADD CONSTRAINT "Criterion_gigId_fkey" FOREIGN KEY ("gigId") REFERENCES "Gig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_gigId_fkey" FOREIGN KEY ("gigId") REFERENCES "Gig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscrowRecord" ADD CONSTRAINT "EscrowRecord_gigId_fkey" FOREIGN KEY ("gigId") REFERENCES "Gig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_gigId_fkey" FOREIGN KEY ("gigId") REFERENCES "Gig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_neutralId_fkey" FOREIGN KEY ("neutralId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_gigId_fkey" FOREIGN KEY ("gigId") REFERENCES "Gig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

