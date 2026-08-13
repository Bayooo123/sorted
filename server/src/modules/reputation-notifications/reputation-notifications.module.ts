import { Module } from '@nestjs/common';
import { ReputationService } from './reputation.service';
import { NotificationsService } from './notifications.service';
import { NOTIFICATIONS_PORT } from './notifications.interface';

/**
 * One Nest module for HANDOFF.md §3.9 (Reputation & Notifications is listed
 * as module 9 of nine), holding two independent services with two separate
 * interfaces — they don't share state, they just share a boundary.
 *
 * NotificationsService is exported behind the NOTIFICATIONS_PORT token
 * (matching Ledger/Matching/Payments/Verification's pattern) so Identity
 * depends on the interface, not the concrete Africa's Talking
 * implementation — swapping providers later doesn't touch Identity.
 */
@Module({
  providers: [
    ReputationService,
    NotificationsService,
    { provide: NOTIFICATIONS_PORT, useExisting: NotificationsService },
  ],
  exports: [ReputationService, NOTIFICATIONS_PORT],
})
export class ReputationNotificationsModule {}
