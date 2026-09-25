import { Module } from '@nestjs/common';
import { IdentityService } from './identity.service';
import { IdentityController } from './identity.controller';
import { ReputationNotificationsModule } from '../reputation-notifications/reputation-notifications.module';
import { AuthModule } from '../../common/auth/auth.module';
import { PaymentsModule } from '../payments/payments.module';

// PaymentsModule (leaf module — only ConfigModule of its own, see
// payments.module.ts) is safe here for the same no-cycle reasoning
// GigsModule's own doc comment gives for importing WhatsappModule.
// PLAN.md "Account number verification" — setPayoutDestination resolves
// a professional's bank details against PaymentsProvider before saving.
@Module({
  imports: [ReputationNotificationsModule, AuthModule, PaymentsModule],
  controllers: [IdentityController],
  providers: [IdentityService],
  exports: [IdentityService],
})
export class IdentityModule {}
