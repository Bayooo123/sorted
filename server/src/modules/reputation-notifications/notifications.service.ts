import { Injectable, Logger, NotImplementedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationEvent, NotificationsPort, NotifyTarget } from './notifications.interface';

/**
 * v1 implements two channels — SMS via Africa's Talking, email via Resend
 * — for exactly one event kind — 'otp' — because that's what slice 2
 * needs. Other event kinds (gig_funded, escrow_released, ...) stay
 * unimplemented until their owning slice lands; see the switch below.
 *
 * SEAM (HANDOFF.md §3.9): channel-agnostic notify() is the contract:
 * adding push/WhatsApp later means branching inside this one method
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
        if (target.email) {
          await this.sendOtpEmail(target.email, event.code);
        } else if (target.phone) {
          await this.sendSms(target.phone, `Your Sorted verification code is ${event.code}. It expires shortly. Don't share this code.`);
        } else {
          throw new Error('NotifyTarget has neither phone nor email — nowhere to send the OTP');
        }
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

  /**
   * Resend REST API directly via fetch, same pattern as the landing
   * page's api/send-welcome-email.js — this is a separate deployment
   * (the NestJS server), so it needs its own RESEND_API_KEY, not the
   * landing page's Vercel env var.
   */
  private async sendOtpEmail(email: string, code: string): Promise<void> {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    if (!apiKey) {
      throw new Error('RESEND_API_KEY is not set — see server/.env.example');
    }
    const from = this.config.get<string>('RESEND_FROM_EMAIL') || 'Sorted <onboarding@resend.dev>';

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: email,
        subject: `${code} is your Sorted verification code`,
        html: this.otpEmailHtml(code),
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Resend email send failed: ${response.status} ${text}`);
    }

    this.logger.log(`OTP email sent to ${email}`);
  }

  private otpEmailHtml(code: string): string {
    // Inline CSS throughout — email clients don't reliably support <style>
    // blocks. Design tokens match HANDOFF.md §6.
    return `
<!doctype html>
<html>
<body style="margin:0;padding:0;background:#F4FAF8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:420px;margin:0 auto;padding:40px 24px;">
    <div style="display:flex;align-items:center;gap:9px;margin-bottom:32px;">
      <div style="width:26px;height:26px;border-radius:8px;background:#C8FFF6;display:inline-block;vertical-align:middle;text-align:center;line-height:26px;color:#027A61;font-weight:700;font-size:14px;">&#10003;</div>
      <span style="font-family:Georgia,'Times New Roman',serif;font-weight:700;letter-spacing:0.03em;text-transform:uppercase;font-size:17px;color:#0C1F1B;vertical-align:middle;">Sorted</span>
    </div>
    <div style="background:#FFFFFF;border:1px solid #E0E6E4;border-radius:20px;padding:36px 32px;text-align:center;">
      <p style="font-size:13px;color:#7E8F8D;margin:0 0 16px;">Your verification code</p>
      <p style="font-family:Georgia,'Times New Roman',serif;font-size:36px;font-weight:700;letter-spacing:0.08em;color:#0C1F1B;margin:0 0 16px;">${code}</p>
      <p style="font-size:13px;color:#7E8F8D;margin:0;">Expires shortly. Don't share this code with anyone.</p>
    </div>
  </div>
</body>
</html>`;
  }
}
