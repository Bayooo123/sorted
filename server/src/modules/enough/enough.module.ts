import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth/auth.module';
import { EnoughAccountsService } from './enough-accounts.service';
import { EnoughController } from './enough.controller';
import { EnoughWebhookController } from './enough-webhook.controller';
import { BachsConnectAccountProvider } from './providers/bachs-connect-account.provider';
import { BACHS_CONNECT_ACCOUNT_PORT } from './enough.interface';

/**
 * PLAN.md "Enough: Bachs Connect account per signup" — AuthModule imported
 * directly for JwtAuthGuard on EnoughController's routes, same reasoning as
 * GigsModule's own doc comment on why it does the same.
 */
@Module({
  imports: [AuthModule],
  controllers: [EnoughController, EnoughWebhookController],
  providers: [EnoughAccountsService, { provide: BACHS_CONNECT_ACCOUNT_PORT, useClass: BachsConnectAccountProvider }],
})
export class EnoughModule {}
