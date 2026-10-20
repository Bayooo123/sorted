import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth/auth.module';
import { ReputationNotificationsModule } from '../reputation-notifications/reputation-notifications.module';
import { EnoughAccountsService } from './enough-accounts.service';
import { EnoughPurposesService } from './enough-purposes.service';
import { EnoughPlanService } from './enough-plan.service';
import { EnoughPaymentsService } from './enough-payments.service';
import { EnoughController } from './enough.controller';
import { EnoughPurposesController } from './enough-purposes.controller';
import { EnoughPlanController } from './enough-plan.controller';
import { EnoughPaymentsController } from './enough-payments.controller';
import { EnoughWebhookController } from './enough-webhook.controller';
import { EnoughPayoutWebhookController } from './enough-payout-webhook.controller';
import { BachsConnectAccountProvider } from './providers/bachs-connect-account.provider';
import { BachsPayoutProvider } from './providers/bachs-payout.provider';
import { BACHS_CONNECT_ACCOUNT_PORT, BACHS_PAYOUT_PORT } from './enough.interface';

/**
 * PLAN.md "Enough: Bachs Connect account per signup" — AuthModule imported
 * directly for JwtAuthGuard on EnoughController's routes, same reasoning as
 * GigsModule's own doc comment on why it does the same. ReputationNotifications
 * imported for the welcome/deposit/payment-status emails fired from this
 * module's services.
 */
@Module({
  imports: [AuthModule, ReputationNotificationsModule],
  controllers: [
    EnoughController,
    EnoughPurposesController,
    EnoughPlanController,
    EnoughPaymentsController,
    EnoughWebhookController,
    EnoughPayoutWebhookController,
  ],
  providers: [
    EnoughAccountsService,
    EnoughPurposesService,
    EnoughPlanService,
    EnoughPaymentsService,
    { provide: BACHS_CONNECT_ACCOUNT_PORT, useClass: BachsConnectAccountProvider },
    { provide: BACHS_PAYOUT_PORT, useClass: BachsPayoutProvider },
  ],
})
export class EnoughModule {}
