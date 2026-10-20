-- CreateTable
CREATE TABLE "EnoughPurposeTranche" (
    "id" TEXT NOT NULL,
    "purposeId" TEXT NOT NULL,
    "amountKobo" BIGINT NOT NULL,
    "releaseAt" TIMESTAMP(3) NOT NULL,
    "releasedEarlyAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnoughPurposeTranche_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "EnoughPurposeTranche" ADD CONSTRAINT "EnoughPurposeTranche_purposeId_fkey" FOREIGN KEY ("purposeId") REFERENCES "EnoughPurpose"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

