-- CreateEnum
CREATE TYPE "KycRequestStatus" AS ENUM ('pending', 'approved', 'rejected');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avatarBase64" TEXT;

-- CreateTable
CREATE TABLE "KycRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentBase64" TEXT NOT NULL,
    "note" TEXT,
    "status" "KycRequestStatus" NOT NULL DEFAULT 'pending',
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KycRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KycRequest_userId_idx" ON "KycRequest"("userId");

-- AddForeignKey
ALTER TABLE "KycRequest" ADD CONSTRAINT "KycRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
