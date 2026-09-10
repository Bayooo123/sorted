import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { GigsModule } from '../gigs/gigs.module';
import { EscrowModule } from '../escrow/escrow.module';
import { RatingsModule } from '../ratings/ratings.module';
import { WhatsappModule } from './whatsapp.module';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';
import { WhatsappGigConversationService } from './whatsapp-gig-conversation.service';
import { WhatsappInviteService } from './whatsapp-invite.service';
import { WhatsappBroadcastService } from './whatsapp-broadcast.service';

/**
 * Separate from WhatsappModule on purpose — see whatsapp.interface.ts's
 * doc comment. Imported only by AppModule; nothing else may import this
 * module (that's what would reintroduce the cycle it exists to avoid).
 *
 * GigsModule/EscrowModule/RatingsModule are safe to import here (unlike
 * Identity's own dependency on Notifications->Whatsapp): none of them
 * imports anything that chains back to this module, so no cycle.
 */
@Module({
  imports: [IdentityModule, WhatsappModule, GigsModule, EscrowModule, RatingsModule],
  controllers: [WhatsappWebhookController],
  providers: [WhatsappGigConversationService, WhatsappInviteService, WhatsappBroadcastService],
})
export class WhatsappWebhookModule {}
