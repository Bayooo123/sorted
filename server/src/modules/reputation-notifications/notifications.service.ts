import { Injectable, Logger, NotImplementedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationEvent, NotificationsPort, NotifyTarget } from './notifications.interface';

/**
 * 'user_signed_up' (welcome email) and 'password_reset_requested' (reset
 * code email) are the only implemented event kinds — see PLAN.md "Welcome
 * email on signup" and "Forgot password". Everything else (gig_funded,
 * escrow_released, ...) stays unimplemented until its owning slice lands.
 * The Africa's Talking SMS integration from the old OTP flow was removed
 * entirely (dead code, not kept "just in case") — whichever slice needs
 * SMS first re-adds it then, per this module's channel-agnostic seam.
 *
 * SEAM (HANDOFF.md §3.9): channel-agnostic notify() is the contract:
 * adding push/WhatsApp/SMS later means branching inside this one method
 * (or extracting a NotificationChannel strategy if it grows past a few
 * channels) — callers never change.
 */
@Injectable()
export class NotificationsService implements NotificationsPort {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly config: ConfigService) {}

  async notify(target: NotifyTarget, event: NotificationEvent): Promise<void> {
    switch (event.kind) {
      case 'user_signed_up':
        if (!target.email) return; // no email on this account yet — nothing to send
        await this.sendWelcomeEmail(target.email, event.name);
        return;
      case 'password_reset_requested':
        if (!target.email) return; // no email on this account — caller already checked, but stay defensive
        await this.sendPasswordResetEmail(target.email, event.code);
        return;
      default:
        throw new NotImplementedException(
          `NotificationsService.notify — event kind '${event.kind}' not implemented yet (lands with its owning slice)`,
        );
    }
  }

  /**
   * Resend REST API directly via fetch, same pattern as the landing
   * page's api/send-welcome-email.js (the waitlist's welcome email — a
   * separate deployment/audience from this one) and the old OTP email
   * this replaced. Separate RESEND_API_KEY from the landing page's own
   * Vercel env var, since this is the server's deployment.
   */
  private async sendEmail(to: string, subject: string, html: string): Promise<void> {
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
      body: JSON.stringify({ from, to, subject, html }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Resend email send failed: ${response.status} ${text}`);
    }
  }

  private async sendWelcomeEmail(email: string, name: string): Promise<void> {
    const firstName = name.trim().split(/\s+/)[0] || name;
    await this.sendEmail(email, 'Welcome to Sorted — let’s get things sorted', this.welcomeEmailHtml(firstName));
    this.logger.log(`Welcome email sent to ${email}`);
  }

  private async sendPasswordResetEmail(email: string, code: string): Promise<void> {
    await this.sendEmail(email, 'Your Sorted password reset code', this.passwordResetEmailHtml(code));
    this.logger.log(`Password reset email sent to ${email}`);
  }

  private welcomeEmailHtml(firstName: string): string {
    // Inline CSS throughout — email clients don't reliably support <style>
    // blocks. Design tokens match HANDOFF.md §6.
    return `
<!doctype html>
<html>
<body style="margin:0;padding:0;background:#F4FAF8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:480px;margin:0 auto;padding:40px 24px;">
    <div style="display:flex;align-items:center;gap:9px;margin-bottom:32px;">
      <div style="width:26px;height:26px;border-radius:8px;background:#C8FFF6;display:inline-block;vertical-align:middle;text-align:center;line-height:26px;color:#027A61;font-weight:700;font-size:14px;">&#10003;</div>
      <span style="font-family:Georgia,'Times New Roman',serif;font-weight:700;letter-spacing:0.03em;text-transform:uppercase;font-size:17px;color:#0C1F1B;vertical-align:middle;">Sorted</span>
    </div>
    <div style="background:#FFFFFF;border:1px solid #E0E6E4;border-radius:20px;padding:36px 32px;">
      <p style="font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:700;color:#0C1F1B;margin:0 0 16px;">Welcome, ${firstName}.</p>
      <p style="font-size:15px;line-height:1.6;color:#3A4A47;margin:0 0 16px;">
        You're in &mdash; the marketplace for getting things actually sorted.
        Whatever needs doing, Sorted connects you with professionals, artisans,
        and service providers who can get it done.
      </p>
      <p style="font-size:15px;line-height:1.6;color:#3A4A47;margin:0 0 16px;">
        Here's what makes it different: you set what &ldquo;done&rdquo; looks like,
        the money sits in escrow until the work is verified, and payment only
        releases once you sign off.
      </p>
      <p style="font-size:15px;line-height:1.6;color:#3A4A47;margin:0;">
        Next step: open the Sorted app &mdash; that's where you post a gig or
        start claiming work.
      </p>
    </div>
    <p style="font-size:12.5px;color:#7E8F8D;margin:24px 0 0;text-align:center;">Consider it sorted.</p>
  </div>
</body>
</html>`;
  }

  private passwordResetEmailHtml(code: string): string {
    return `
<!doctype html>
<html>
<body style="margin:0;padding:0;background:#F4FAF8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:480px;margin:0 auto;padding:40px 24px;">
    <div style="display:flex;align-items:center;gap:9px;margin-bottom:32px;">
      <div style="width:26px;height:26px;border-radius:8px;background:#C8FFF6;display:inline-block;vertical-align:middle;text-align:center;line-height:26px;color:#027A61;font-weight:700;font-size:14px;">&#10003;</div>
      <span style="font-family:Georgia,'Times New Roman',serif;font-weight:700;letter-spacing:0.03em;text-transform:uppercase;font-size:17px;color:#0C1F1B;vertical-align:middle;">Sorted</span>
    </div>
    <div style="background:#FFFFFF;border:1px solid #E0E6E4;border-radius:20px;padding:36px 32px;">
      <p style="font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:700;color:#0C1F1B;margin:0 0 16px;">Reset your password</p>
      <p style="font-size:15px;line-height:1.6;color:#3A4A47;margin:0 0 24px;">
        Enter this code to set a new password. It expires in 15 minutes.
        If you didn't request this, you can ignore this email.
      </p>
      <p style="font-family:Georgia,'Times New Roman',serif;font-size:32px;font-weight:700;letter-spacing:0.08em;color:#0C1F1B;background:#F4FAF8;border-radius:12px;padding:16px 0;margin:0;text-align:center;">${code}</p>
    </div>
    <p style="font-size:12.5px;color:#7E8F8D;margin:24px 0 0;text-align:center;">Consider it sorted.</p>
  </div>
</body>
</html>`;
  }
}
