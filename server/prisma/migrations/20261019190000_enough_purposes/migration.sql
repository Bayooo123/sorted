-- CreateTable
CREATE TABLE "EnoughPurpose" (
    "id" TEXT NOT NULL,
    "enoughAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "balanceKobo" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnoughPurpose_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EnoughPurpose_enoughAccountId_name_key" ON "EnoughPurpose"("enoughAccountId", "name");

-- AddForeignKey
ALTER TABLE "EnoughPurpose" ADD CONSTRAINT "EnoughPurpose_enoughAccountId_fkey" FOREIGN KEY ("enoughAccountId") REFERENCES "EnoughAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

