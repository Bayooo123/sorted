import { Module } from '@nestjs/common';
import { GigsService } from './gigs.service';
import { GigsController } from './gigs.controller';
import { TaxonomyController } from './taxonomy.controller';
import { IdentityModule } from '../identity/identity.module';
import { MatchingModule } from '../matching/matching.module';
import { AuthModule } from '../../common/auth/auth.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

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
@Module({
  imports: [IdentityModule, MatchingModule, AuthModule, DeliveryModule, WhatsappModule],
  controllers: [TaxonomyController, GigsController],
  providers: [GigsService],
  exports: [GigsService],
})
export class GigsModule {}
