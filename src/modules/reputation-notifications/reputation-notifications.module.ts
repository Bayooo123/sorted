import { Module } from '@nestjs/common';
import { ReputationService } from './reputation.service';
import { NotificationsService } from './notifications.service';

/**
 * One Nest module for HANDOFF.md §3.9 (Reputation & Notifications is listed
 * as module 9 of nine), holding two independent services with two separate
 * interfaces — they don't share state, they just share a boundary.
 */
@Module({
  providers: [ReputationService, NotificationsService],
  exports: [ReputationService, NotificationsService],
})
export class ReputationNotificationsModule {}
