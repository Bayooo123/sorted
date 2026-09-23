import { Module } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { WhatsappAdminController } from './whatsapp-admin.controller';
import { WHATSAPP_PORT } from './whatsapp.interface';

/**
 * Deliberately has NO IdentityModule import — see whatsapp.interface.ts's
 * doc comment for why. The inbound webhook lives in WhatsappWebhookModule
 * instead, which imports both this module and IdentityModule.
 * WhatsappAdminController is the one controller here — it only needs the
 * global PrismaService (see its own doc comment), so it doesn't
 * reintroduce that cycle.
 */
@Module({
  controllers: [WhatsappAdminController],
  providers: [WhatsappService, { provide: WHATSAPP_PORT, useExisting: WhatsappService }],
  exports: [WHATSAPP_PORT],
})
export class WhatsappModule {}
