-- CreateEnum
CREATE TYPE "DeliveryLeg" AS ENUM ('pickup_to_professional', 'return_to_client');

-- CreateEnum
CREATE TYPE "DeliveryTaskStatus" AS ENUM ('upcoming', 'started', 'arrived', 'ended', 'failed', 'unassigned', 'accepted', 'declined', 'cancelled', 'deleted');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "professionalAddressText" TEXT,
ADD COLUMN     "professionalAddressLat" DOUBLE PRECISION,
ADD COLUMN     "professionalAddressLng" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "DeliveryTask" (
    "id" TEXT NOT NULL,
    "gigId" TEXT NOT NULL,
    "leg" "DeliveryLeg" NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'kwik',
    "providerJobId" TEXT,
    "status" "DeliveryTaskStatus" NOT NULL DEFAULT 'upcoming',
    "trackingLink" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeliveryTask_gigId_idx" ON "DeliveryTask"("gigId");

-- AddForeignKey
ALTER TABLE "DeliveryTask" ADD CONSTRAINT "DeliveryTask_gigId_fkey" FOREIGN KEY ("gigId") REFERENCES "Gig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
