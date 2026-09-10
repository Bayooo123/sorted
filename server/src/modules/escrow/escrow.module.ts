import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { LedgerModule } from '../ledger/ledger.module';
import { GigsModule } from '../gigs/gigs.module';
import { IdentityModule } from '../identity/identity.module';
import { MatchingModule } from '../matching/matching.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { AuthModule } from '../../common/auth/auth.module';
import { EscrowService } from './escrow.service';
import { EscrowController } from './escrow.controller';
import { PaystackWebhookController } from './paystack-webhook.controller';

// WhatsappModule (lean — see whatsapp.interface.ts) is safe to import here:
// it has zero imports of its own, so Escrow -> Whatsapp adds no cycle, same
// reasoning as Notifications -> Whatsapp and WhatsappWebhookModule -> Escrow.
@Module({
  imports: [PaymentsModule, LedgerModule, GigsModule, IdentityModule, MatchingModule, WhatsappModule, AuthModule],
  controllers: [EscrowController, PaystackWebhookController],
  providers: [EscrowService],
  exports: [EscrowService],
})
export class EscrowModule {}
