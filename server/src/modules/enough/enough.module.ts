import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { NombaWebhookController } from './nomba-webhook.controller';
import { PagaWebhookController } from './paga-webhook.controller';
import { SettlementSweepService } from './settlement-sweep.service';
import { SettlementCronController } from './settlement-cron.controller';
import { BachsConnectAccountProvider } from './providers/bachs-connect-account.provider';
import { BachsPayoutProvider } from './providers/bachs-payout.provider';
import { NombaConnectAccountProvider } from './providers/nomba-connect-account.provider';
import { NombaPayoutProvider } from './providers/nomba-payout.provider';
import { PagaConnectAccountProvider } from './providers/paga-connect-account.provider';
import { PagaPayoutProvider } from './providers/paga-payout.provider';
import {
  BachsConnectAccountPort,
  BachsPayoutPort,
  BACHS_CONNECT_ACCOUNT_PORT,
  BACHS_PAYOUT_PORT,
  SETTLEMENT_PAYOUT_PORT,
} from './enough.interface';

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
    NombaWebhookController,
    PagaWebhookController,
    SettlementCronController,
  ],
  providers: [
    EnoughAccountsService,
    EnoughPurposesService,
    EnoughPlanService,
    EnoughPaymentsService,
    SettlementSweepService,
    BachsConnectAccountProvider,
    BachsPayoutProvider,
    NombaConnectAccountProvider,
    NombaPayoutProvider,
    PagaConnectAccountProvider,
    PagaPayoutProvider,
    {
      provide: BACHS_CONNECT_ACCOUNT_PORT,
      useFactory: (
        config: ConfigService,
        bachs: BachsConnectAccountProvider,
        nomba: NombaConnectAccountProvider,
        paga: PagaConnectAccountProvider,
      ): BachsConnectAccountPort => {
        const key = config.get<string>('ENOUGH_PROVIDER_KEY');
        return key === 'nomba' ? nomba : key === 'paga' ? paga : bachs;
      },
      inject: [ConfigService, BachsConnectAccountProvider, NombaConnectAccountProvider, PagaConnectAccountProvider],
    },
    {
      provide: BACHS_PAYOUT_PORT,
      useFactory: (config: ConfigService, bachs: BachsPayoutProvider, nomba: NombaPayoutProvider, paga: PagaPayoutProvider): BachsPayoutPort => {
        const key = config.get<string>('ENOUGH_PROVIDER_KEY');
        return key === 'nomba' ? nomba : key === 'paga' ? paga : bachs;
      },
      inject: [ConfigService, BachsPayoutProvider, NombaPayoutProvider, PagaPayoutProvider],
    },
    // PLAN.md "Settlement sweep" — fixed to Nomba, never switched by
    // ENOUGH_PROVIDER_KEY. See SETTLEMENT_PAYOUT_PORT's doc comment.
    { provide: SETTLEMENT_PAYOUT_PORT, useExisting: NombaPayoutProvider },
  ],
})
export class EnoughModule {}
