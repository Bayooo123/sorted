-- PLAN.md "Sorted-owned rider fleet"

-- AlterEnum: two new DeliveryTaskStatus values the Sorted-fleet rider flow
-- produces that KWIK never does (KWIK goes straight from arrived to ended).
ALTER TYPE "DeliveryTaskStatus" ADD VALUE 'picked_up';
ALTER TYPE "DeliveryTaskStatus" ADD VALUE 'in_transit';

-- AlterTable: assignment + pickup-code + piece-count columns on DeliveryTask.
ALTER TABLE "DeliveryTask" ADD COLUMN "riderId" TEXT;
ALTER TABLE "DeliveryTask" ADD COLUMN "pickupCodeHash" TEXT;
ALTER TABLE "DeliveryTask" ADD COLUMN "pickupCodeExpiresAt" TIMESTAMP(3);
ALTER TABLE "DeliveryTask" ADD COLUMN "pickupCodeAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DeliveryTask" ADD COLUMN "pieceCount" INTEGER;

CREATE INDEX "DeliveryTask_riderId_idx" ON "DeliveryTask"("riderId");

ALTER TABLE "DeliveryTask" ADD CONSTRAINT "DeliveryTask_riderId_fkey"
  FOREIGN KEY ("riderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: RiderProfile, one row per User with the "rider" roleFlag.
CREATE TABLE "RiderProfile" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "online" BOOLEAN NOT NULL DEFAULT false,
  "vehicleType" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RiderProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RiderProfile_userId_key" ON "RiderProfile"("userId");

ALTER TABLE "RiderProfile" ADD CONSTRAINT "RiderProfile_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
