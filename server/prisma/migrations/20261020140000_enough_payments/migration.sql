-- CreateTable
CREATE TABLE "EnoughPaymentEvent" (
    "id" TEXT NOT NULL,
    "enoughAccountId" TEXT NOT NULL,
    "sourcePurposeId" TEXT,
    "amountKobo" BIGINT NOT NULL,
    "recipientBankCode" TEXT NOT NULL,
    "recipientBankName" TEXT,
    "recipientAccountNumber" TEXT NOT NULL,
    "recipientAccountName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "failureReason" TEXT,
    "bachsTransferId" TEXT,
    "bachsWithdrawalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnoughPaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EnoughPaymentEvent_bachsWithdrawalId_key" ON "EnoughPaymentEvent"("bachsWithdrawalId");

-- AddForeignKey
ALTER TABLE "EnoughPaymentEvent" ADD CONSTRAINT "EnoughPaymentEvent_enoughAccountId_fkey" FOREIGN KEY ("enoughAccountId") REFERENCES "EnoughAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

