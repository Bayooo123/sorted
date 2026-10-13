import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth/auth.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { DigestService } from './digest.service';
import { DigestCronController } from './digest-cron.controller';
import { ReputationNotificationsModule } from '../reputation-notifications/reputation-notifications.module';

/**
 * Only needs the global PrismaService for the dashboard read — no
 * cross-module ports there, this is an admin read, not product business
 * logic. AuthModule is for AdminGuard's JwtService.
 *
 * ReputationNotificationsModule (imports only WhatsappModule, a leaf — see
 * its own doc comment) is added for DigestService's NOTIFICATIONS_PORT
 * dependency (PLAN.md "Daily founder briefing email") — no path back to
 * AnalyticsModule, so this doesn't create a cycle.
 */
@Module({
  imports: [AuthModule, ReputationNotificationsModule],
  controllers: [AnalyticsController, DigestCronController],
  providers: [AnalyticsService, DigestService],
})
export class AnalyticsModule {}
