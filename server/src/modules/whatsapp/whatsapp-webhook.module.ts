import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { WhatsappModule } from './whatsapp.module';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';

/**
 * Separate from WhatsappModule on purpose — see whatsapp.interface.ts's
 * doc comment. Imported only by AppModule; nothing else may import this
 * module (that's what would reintroduce the cycle it exists to avoid).
 */
@Module({
  imports: [IdentityModule, WhatsappModule],
  controllers: [WhatsappWebhookController],
})
export class WhatsappWebhookModule {}
