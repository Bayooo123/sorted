-- AlterTable
ALTER TABLE "Gig" ADD COLUMN     "restrictedToProfessionalId" TEXT;

-- AlterTable
ALTER TABLE "WhatsAppSession" ADD COLUMN     "draftInviteeName" TEXT,
ADD COLUMN     "draftInviteeProfessionalId" TEXT,
ADD COLUMN     "pendingInviteGigId" TEXT;

-- AddForeignKey
ALTER TABLE "Gig" ADD CONSTRAINT "Gig_restrictedToProfessionalId_fkey" FOREIGN KEY ("restrictedToProfessionalId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
