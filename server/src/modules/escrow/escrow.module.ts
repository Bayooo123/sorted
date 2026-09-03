import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { LedgerModule } from '../ledger/ledger.module';
import { GigsModule } from '../gigs/gigs.module';
import { IdentityModule } from '../identity/identity.module';
import { AuthModule } from '../../common/auth/auth.module';
import { EscrowService } from './escrow.service';
import { EscrowController } from './escrow.controller';
import { PaystackWebhookController } from './paystack-webhook.controller';

@Module({
  imports: [PaymentsModule, LedgerModule, GigsModule, IdentityModule, AuthModule],
  controllers: [EscrowController, PaystackWebhookController],
  providers: [EscrowService],
  exports: [EscrowService],
})
export class EscrowModule {}
