-- CreateTable
CREATE TABLE "EnoughAllocationEvent" (
    "id" TEXT NOT NULL,
    "enoughAccountId" TEXT NOT NULL,
    "purposeId" TEXT NOT NULL,
    "amountKobo" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnoughAllocationEvent_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "EnoughAllocationEvent" ADD CONSTRAINT "EnoughAllocationEvent_enoughAccountId_fkey" FOREIGN KEY ("enoughAccountId") REFERENCES "EnoughAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnoughAllocationEvent" ADD CONSTRAINT "EnoughAllocationEvent_purposeId_fkey" FOREIGN KEY ("purposeId") REFERENCES "EnoughPurpose"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

