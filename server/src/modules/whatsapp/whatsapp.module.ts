import { Module } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { WHATSAPP_PORT } from './whatsapp.interface';

/**
 * Deliberately has NO controller and NO IdentityModule import — see
 * whatsapp.interface.ts's doc comment for why. The inbound webhook lives
 * in WhatsappWebhookModule instead, which imports both this module and
 * IdentityModule.
 */
@Module({
  providers: [WhatsappService, { provide: WHATSAPP_PORT, useExisting: WhatsappService }],
  exports: [WHATSAPP_PORT],
})
export class WhatsappModule {}
