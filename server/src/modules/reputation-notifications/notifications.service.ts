import { Injectable, Logger, NotImplementedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationEvent, NotificationsPort, NotifyTarget } from './notifications.interface';

/**
 * No event kind is implemented yet — each lands with its owning slice
 * (gig_funded, escrow_released, ...). SMS (Africa's Talking) and email
 * (Resend) integration code from the old OTP flow was removed when auth
 * moved to email/phone + password (see PLAN.md "Password-based auth");
 * re-add whichever channel a real event needs when that slice lands.
 *
 * SEAM (HANDOFF.md §3.9): channel-agnostic notify() is the contract:
 * adding push/WhatsApp/SMS/email later means branching inside this one
 * method (or extracting a NotificationChannel strategy if it grows past a
 * few channels) — callers never change.
 */
@Injectable()
export class NotificationsService implements NotificationsPort {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly config: ConfigService) {}

  async notify(_target: NotifyTarget, event: NotificationEvent): Promise<void> {
    throw new NotImplementedException(
      `NotificationsService.notify — event kind '${event.kind}' not implemented yet (lands with its owning slice)`,
    );
  }
}
