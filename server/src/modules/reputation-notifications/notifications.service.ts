import { Inject, Injectable, Logger, NotImplementedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WHATSAPP_PORT, WhatsAppPort } from '../whatsapp/whatsapp.interface';
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

  constructor(
    private readonly config: ConfigService,
    @Inject(WHATSAPP_PORT) private readonly whatsapp: WhatsAppPort,
  ) {}

  async notify(target: NotifyTarget, event: NotificationEvent): Promise<void> {
    switch (event.kind) {
      case 'user_signed_up': {
        const firstName = event.name.trim().split(/\s+/)[0] || event.name;
        if (target.email) {
          await this.sendWelcomeEmail(target.email, event.name);
        }
        if (target.phone) {
          // Best-effort — sendMessage no-ops outside the 24h session
          // window (see whatsapp.service.ts) rather than sending nothing
          // silently different from "we tried and it failed."
          await this.whatsapp.sendMessage(
            target.phone,
            `Thanks for joining Sorted, ${firstName}! What would you like to get done today?`,
          );
        }
        return;
      }
      case 'password_reset_requested':
        if (!target.email) return; // no email on this account — caller already checked, but stay defensive
        await this.sendPasswordResetEmail(target.email, event.code);
        return;
      case 'professional_invited':
        if (!target.email) return; // no email on this account — caller already checked, but stay defensive
        await this.sendInviteEmail(target.email, event.clientName, event.gigDescription, event.submarketLabel, event.locationText, event.bountyKobo);
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

  private async sendInviteEmail(
    email: string,
    clientName: string,
    gigDescription: string,
    submarketLabel: string,
    locationText: string,
    bountyKobo: number,
  ): Promise<void> {
    const subject = `${clientName.trim().split(/\s+/)[0] || clientName} picked you for a job on Sorted`;
    await this.sendEmail(email, subject, this.inviteEmailHtml(clientName, gigDescription, submarketLabel, locationText, bountyKobo));
    this.logger.log(`Direct-invite email sent to ${email}`);
  }

  /** clientName/gigDescription/locationText are user-typed (signup name, gig description, free-text location) — escaped before interpolation, unlike the older templates in this file (firstName in welcomeEmailHtml is a pre-existing gap, not fixed here — out of scope for this change). */
  private escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
        Here's what makes it different: every job you complete here becomes
        part of a real track record &mdash; proof of work you can point to,
        not just a payment that came and went. You set what &ldquo;done&rdquo;
        looks like, nothing is charged until you sign off that it's actually
        done, and once you do, that job is added to the record for good.
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

  /**
   * PLAN.md "Direct-invite email redesign" — visual design supplied by the
   * founder (built elsewhere, handed over as a screenshot), reproduced here
   * with three corrections against what's actually true of this codebase
   * rather than copied verbatim:
   *   1. The mock's "We hold the money and pay you once the job is done"
   *      line describes the pre-pivot escrow model — Paystack declined
   *      that (see PLAN.md "Split payment pivot"). Replaced with the same
   *      "nothing's charged until approval, paid the same moment" language
   *      index.html already uses.
   *   2. The mock's footer read "Sorted Innovations Limited · RC 9770241"
   *      — not this company. Replaced with the real registered entity
   *      already used in index.html's footer (Reforma Digital Solutions
   *      Limited · RC 8801487, 26 Ebun Street, Abule Oja, Yaba, Lagos).
   *   3. The mock's "When: Pickup Tue 30 Sept, 4–6pm" row has no backing
   *      data — Gig has no scheduled-time field. Swapped for "Category"
   *      (the gig's submarket label), which is real and keeps the
   *      three-row layout.
   * The mock's one-click "Decline here" link implies a signed, no-login
   * magic link (new backend surface, real security tradeoffs to get
   * right) that doesn't exist yet — both the primary and secondary CTA
   * point at the site for now; see PLAN.md for the follow-up.
   */
  private inviteEmailHtml(clientName: string, gigDescription: string, submarketLabel: string, locationText: string, bountyKobo: number): string {
    // &#8358; (₦), not the literal glyph — every other template here uses
    // HTML entities for non-ASCII (&mdash;, &ldquo;, ...) rather than
    // relying on a charset declaration email clients may strip; found via
    // a rendered screenshot showing "â‚¦" mojibake before that fix.
    const amountNaira = '&#8358;' + (bountyKobo / 100).toLocaleString('en-NG', { maximumFractionDigits: 0 });
    const clientFirstName = this.escapeHtml(clientName.trim().split(/\s+/)[0] || clientName);
    const description = this.escapeHtml(gigDescription);
    const category = this.escapeHtml(submarketLabel);
    const location = this.escapeHtml(locationText);

    return `
<!doctype html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#F4FAF8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:480px;margin:0 auto;padding:40px 24px;">
    <div style="display:flex;align-items:center;gap:9px;margin-bottom:24px;">
      <div style="width:26px;height:26px;border-radius:8px;background:#C8FFF6;display:inline-block;vertical-align:middle;text-align:center;line-height:26px;color:#027A61;font-weight:700;font-size:14px;">&#10003;</div>
      <span style="font-family:Georgia,'Times New Roman',serif;font-weight:700;letter-spacing:0.03em;text-transform:uppercase;font-size:17px;color:#0C1F1B;vertical-align:middle;">Sorted</span>
    </div>

    <div style="background:#FFFFFF;border:1px solid #E0E6E4;border-radius:20px;overflow:hidden;">
      <div style="background:#027A61;padding:26px 28px 22px;">
        <span style="display:inline-block;background:rgba(255,255,255,0.18);color:#FFFFFF;font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;padding:5px 12px;border-radius:999px;margin:0 0 14px;">&#9733; Exclusive invitation</span>
        <p style="font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:700;color:#FFFFFF;margin:8px 0 8px;line-height:1.25;">${clientFirstName} picked you for this job.</p>
        <p style="font-size:13.5px;line-height:1.5;color:rgba(255,255,255,0.88);margin:0;">Out of every professional on Sorted, ${clientFirstName} chose you by name. Nobody else can take this job while it's reserved for you.</p>
      </div>

      <div style="padding:24px 28px 4px;">
        <p style="font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#7E8F8D;margin:0 0 6px;">You'll earn</p>
        <p style="font-family:Georgia,'Times New Roman',serif;font-size:30px;font-weight:700;color:#027A61;margin:0 0 8px;">${amountNaira}</p>
        <p style="font-size:12.5px;line-height:1.5;color:#7E8F8D;margin:0 0 20px;">Nothing's charged until the job's approved &mdash; you're paid the same moment it is.</p>
      </div>

      <div style="padding:0 28px 24px;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#F4FAF8;border-radius:12px;">
          <tr>
            <td style="padding:12px 14px;font-size:11.5px;color:#7E8F8D;width:78px;vertical-align:top;border-bottom:1px solid #E0E6E4;">The job</td>
            <td style="padding:12px 14px;font-size:13.5px;font-weight:700;color:#0C1F1B;border-bottom:1px solid #E0E6E4;">${description}</td>
          </tr>
          <tr>
            <td style="padding:12px 14px;font-size:11.5px;color:#7E8F8D;vertical-align:top;border-bottom:1px solid #E0E6E4;">Category</td>
            <td style="padding:12px 14px;font-size:13.5px;font-weight:700;color:#0C1F1B;border-bottom:1px solid #E0E6E4;">${category}</td>
          </tr>
          <tr>
            <td style="padding:12px 14px;font-size:11.5px;color:#7E8F8D;vertical-align:top;">Where</td>
            <td style="padding:12px 14px;font-size:13.5px;font-weight:700;color:#0C1F1B;">${location}</td>
          </tr>
        </table>
      </div>

      <div style="padding:0 28px 24px;">
        <a href="https://sorted.com.ng" style="display:block;text-align:center;background:#027A61;color:#FFFFFF;font-size:15px;font-weight:700;padding:15px 0;border-radius:12px;text-decoration:none;">Open Sorted to respond &rarr;</a>
        <p style="text-align:center;font-size:12px;color:#7E8F8D;margin:14px 0 0;">Can't take this job? <a href="https://sorted.com.ng" style="color:#027A61;font-weight:700;text-decoration:underline;">Open Sorted</a> to let us know, so we can offer it to someone else.</p>
      </div>

      <div style="margin:0 28px 28px;padding:16px 18px;border:1px dashed #E0E6E4;border-radius:12px;">
        <p style="font-size:12.5px;font-weight:700;color:#0C1F1B;margin:0 0 4px;">Faster on WhatsApp?</p>
        <p style="font-size:12.5px;line-height:1.5;color:#3A4A47;margin:0;">If you've messaged Sorted before, just reply on that same thread with <strong>YES</strong> to accept or <strong>NO</strong> to decline.</p>
      </div>
    </div>

    <p style="font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:15px;color:#027A61;text-align:center;margin:24px 0 6px;">Consider it sorted.</p>
    <p style="font-size:11.5px;color:#7E8F8D;text-align:center;margin:0 0 4px;">You're getting this because a client booked you directly on Sorted.</p>
    <p style="font-size:11.5px;color:#7E8F8D;text-align:center;margin:0 0 14px;"><a href="https://sorted.com.ng" style="color:#7E8F8D;text-decoration:underline;">sorted.com.ng</a></p>
    <p style="font-size:11px;color:#7E8F8D;text-align:center;margin:0;line-height:1.5;">Reforma Digital Solutions Limited &middot; RC 8801487<br/>26 Ebun Street, Abule Oja, Yaba, Lagos</p>
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
