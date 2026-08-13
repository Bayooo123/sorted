import { Injectable, Logger, NotImplementedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationEvent, NotificationsPort, NotifyTarget } from './notifications.interface';

/**
 * v1 implements exactly one channel — SMS via Africa's Talking — for
 * exactly one event kind — 'otp' — because that's what slice 2 needs.
 * Other event kinds (gig_funded, escrow_released, ...) stay unimplemented
 * until their owning slice lands; see the switch below.
 *
 * SEAM (HANDOFF.md §3.9): channel-agnostic notify() is the contract:
 * adding push/WhatsApp/email later means branching inside this one method
 * (or extracting a NotificationChannel strategy if it grows past a few
 * channels) — callers never change.
 */
@Injectable()
export class NotificationsService implements NotificationsPort {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly config: ConfigService) {}

  async notify(target: NotifyTarget, event: NotificationEvent): Promise<void> {
    switch (event.kind) {
      case 'otp':
        await this.sendSms(target.phone, `Your Sorted verification code is ${event.code}. It expires shortly. Don't share this code.`);
        return;
      default:
        throw new NotImplementedException(
          `NotificationsService.notify — event kind '${event.kind}' not implemented yet (lands with its owning slice)`,
        );
    }
  }

  /**
   * Africa's Talking messaging API. Sandbox and production use the same
   * endpoint; which one you hit is determined by AFRICASTALKING_USERNAME
   * ('sandbox' for the sandbox app) and the matching API key, not a
   * different base URL.
   */
  private async sendSms(phone: string, message: string): Promise<void> {
    const apiKey = this.config.get<string>('AFRICASTALKING_API_KEY');
    const username = this.config.get<string>('AFRICASTALKING_USERNAME');
    const senderId = this.config.get<string>('AFRICASTALKING_SENDER_ID');
    const baseUrl = this.config.get<string>('AFRICASTALKING_BASE_URL') ?? 'https://api.africastalking.com';

    if (!apiKey || !username) {
      throw new Error(
        'AFRICASTALKING_API_KEY / AFRICASTALKING_USERNAME are not set — see server/.env.example',
      );
    }

    const body = new URLSearchParams({ username, to: phone, message });
    if (senderId) body.set('from', senderId);

    const response = await fetch(`${baseUrl}/version1/messaging`, {
      method: 'POST',
      headers: {
        apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Africa's Talking SMS send failed: ${response.status} ${text}`);
    }

    const result = await response.json().catch(() => null);
    const recipients = result?.SMSMessageData?.Recipients;
    const recipient = Array.isArray(recipients) ? recipients[0] : undefined;

    // AT returns 200 even for per-recipient failures (invalid number, no
    // balance, etc.) — the real status is in Recipients[0].status.
    if (recipient && recipient.status !== 'Success') {
      throw new Error(`Africa's Talking SMS rejected: ${recipient.status} (${recipient.statusCode})`);
    }

    this.logger.log(`OTP SMS sent to ${phone} (messageId=${recipient?.messageId ?? 'unknown'})`);
  }
}
