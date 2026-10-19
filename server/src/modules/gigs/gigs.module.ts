import { Module } from '@nestjs/common';
import { GigsService } from './gigs.service';
import { GigsController } from './gigs.controller';
import { TaxonomyController } from './taxonomy.controller';
import { IdentityModule } from '../identity/identity.module';
import { MatchingModule } from '../matching/matching.module';
import { AuthModule } from '../../common/auth/auth.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { PaymentsModule } from '../payments/payments.module';
import { ReputationNotificationsModule } from '../reputation-notifications/reputation-notifications.module';
import { PostcodeModule } from '../postcode/postcode.module';

// AuthModule is imported directly (not just via IdentityModule) because
// GigsController's own routes need JwtAuthGuard — importing shared auth
// infra transitively through a business module would be the wrong
// dependency direction.
//
// WhatsappModule (leaf module — zero imports of its own, see its own doc
// comment) is safe here for the same reason EscrowModule already imports
// it with no cycle. PLAN.md "Split payment pivot" moved
// notifyGigIsOpen/sendInvite/broadcastOpenGig here from EscrowService:
// "a gig became open" is now a publish-time event, not a funding-time one
// — GigsModule importing EscrowModule to keep this in Escrow instead would
// create the real cycle (EscrowModule already imports GigsModule).
//
// PaymentsModule (also a leaf, same no-cycle reasoning) is imported
// directly here — not just transitively via IdentityModule, which already
// imports it — because Nest doesn't re-export a module's own imports by
// default; TaxonomyController needs PAYMENTS_PROVIDER in its own DI scope
// (PLAN.md "Bank list endpoint").
//
// ReputationNotificationsModule only imports WhatsappModule (itself a
// leaf) — no path back to GigsModule, so this doesn't reintroduce a cycle
// either. PLAN.md "Direct-invite email notification": sendInvite needs
// NOTIFICATIONS_PORT to send the invited professional an email alongside
// the existing WhatsApp message.
@Module({
  imports: [IdentityModule, MatchingModule, AuthModule, DeliveryModule, WhatsappModule, PaymentsModule, ReputationNotificationsModule, PostcodeModule],
  controllers: [TaxonomyController, GigsController],
  providers: [GigsService],
  exports: [GigsService],
})
export class GigsModule {}
