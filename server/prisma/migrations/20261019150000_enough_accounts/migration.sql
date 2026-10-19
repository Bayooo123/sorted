-- CreateEnum
CREATE TYPE "EnoughAccountStatus" AS ENUM ('unrequested', 'restricted', 'pending', 'active', 'unsupported');

-- CreateTable
CREATE TABLE "EnoughAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bachsAccountId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "capabilityStatus" "EnoughAccountStatus" NOT NULL DEFAULT 'unrequested',
    "capabilityStatusDetail" TEXT,
    "virtualAccountId" TEXT,
    "virtualAccountNumber" TEXT,
    "virtualAccountBankName" TEXT,
    "virtualAccountBankCode" TEXT,
    "availableBalanceKobo" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnoughAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnoughDepositEvent" (
    "id" TEXT NOT NULL,
    "enoughAccountId" TEXT NOT NULL,
    "chargeId" TEXT NOT NULL,
    "amountKobo" BIGINT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnoughDepositEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EnoughAccount_userId_key" ON "EnoughAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "EnoughAccount_bachsAccountId_key" ON "EnoughAccount"("bachsAccountId");

-- AddForeignKey
ALTER TABLE "EnoughAccount" ADD CONSTRAINT "EnoughAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnoughDepositEvent" ADD CONSTRAINT "EnoughDepositEvent_enoughAccountId_fkey" FOREIGN KEY ("enoughAccountId") REFERENCES "EnoughAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

