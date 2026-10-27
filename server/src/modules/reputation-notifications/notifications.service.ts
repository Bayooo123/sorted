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
      case 'enough_account_opened':
        if (!target.email) return; // no email on this account — caller already checked, but stay defensive
        await this.sendEnoughWelcomeEmail(target.email, event.name);
        return;
      case 'enough_deposit_received':
        if (!target.email) return; // no email on this account — caller already checked, but stay defensive
        await this.sendEnoughDepositEmail(target.email, event.amountKobo, event.availableBalanceKobo);
        return;
      case 'enough_payment_status_changed':
        if (!target.email) return; // no email on this account — caller already checked, but stay defensive
        await this.sendEnoughPaymentStatusEmail(target.email, event.completed, event.amountKobo, event.recipientAccountName, event.failureReason);
        return;
      case 'enough_transfers_enabled':
        if (!target.email) return; // no email on this account — caller already checked, but stay defensive
        await this.sendEnoughTransfersEnabledEmail(target.email);
        return;
      case 'professional_invited':
        if (!target.email) return; // no email on this account — caller already checked, but stay defensive
        await this.sendInviteEmail(target.email, event.gigId, event.clientName, event.gigDescription, event.submarketLabel, event.locationText, event.bountyKobo);
        return;
      case 'founder_daily_digest':
        if (!target.email) return; // no email on this account — caller already checked, but stay defensive
        await this.sendFounderDigestEmail(target.email, event);
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

  private async sendEnoughWelcomeEmail(email: string, name: string): Promise<void> {
    const firstName = name.trim().split(/\s+/)[0] || name;
    await this.sendEmail(email, 'Welcome to Enough — verifying your account', this.enoughWelcomeEmailHtml(firstName));
    this.logger.log(`Enough welcome email sent to ${email}`);
  }

  private async sendEnoughDepositEmail(email: string, amountKobo: number, availableBalanceKobo: string): Promise<void> {
    const nairaText = (kobo: number) => '₦' + (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const nairaHtml = (kobo: number) => '&#8358;' + (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const subject = `${nairaText(amountKobo)} just landed in your Enough account`;
    await this.sendEmail(email, subject, this.enoughDepositEmailHtml(nairaHtml(amountKobo), nairaHtml(Number(availableBalanceKobo))));
    this.logger.log(`Enough deposit email sent to ${email}`);
  }

  private async sendEnoughPaymentStatusEmail(
    email: string,
    completed: boolean,
    amountKobo: number,
    recipientAccountName: string,
    failureReason: string | null,
  ): Promise<void> {
    const nairaText = (kobo: number) => '₦' + (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const nairaHtml = (kobo: number) => '&#8358;' + (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const subject = completed
      ? `Your payment of ${nairaText(amountKobo)} to ${recipientAccountName} went through`
      : `Your payment of ${nairaText(amountKobo)} to ${recipientAccountName} didn't go through`;
    await this.sendEmail(email, subject, this.enoughPaymentStatusEmailHtml(completed, nairaHtml(amountKobo), recipientAccountName, failureReason));
    this.logger.log(`Enough payment status email (${completed ? 'completed' : 'failed'}) sent to ${email}`);
  }

  private async sendEnoughTransfersEnabledEmail(email: string): Promise<void> {
    await this.sendEmail(email, 'Make a payment is ready on Enough', this.enoughTransfersEnabledEmailHtml());
    this.logger.log(`Enough transfers-enabled email sent to ${email}`);
  }

  private async sendFounderDigestEmail(email: string, event: Extract<NotificationEvent, { kind: 'founder_daily_digest' }>): Promise<void> {
    await this.sendEmail(email, `Sorted daily briefing — ${event.periodLabel}`, this.founderDigestEmailHtml(event));
    this.logger.log(`Founder daily digest sent to ${email} for ${event.periodLabel}`);
  }

  private async sendInviteEmail(
    email: string,
    gigId: string,
    clientName: string,
    gigDescription: string,
    submarketLabel: string,
    locationText: string,
    bountyKobo: number,
  ): Promise<void> {
    const subject = `${clientName.trim().split(/\s+/)[0] || clientName} picked you for a job on Sorted`;
    await this.sendEmail(email, subject, this.inviteEmailHtml(gigId, clientName, gigDescription, submarketLabel, locationText, bountyKobo));
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
   * PLAN.md "Enough: Bachs Connect account per signup" — Enough's own
   * brand (amber/sun palette, Bricolage Grotesque + DM Sans), matching
   * enough.html/enough-app.html rather than Sorted's teal/green templates
   * above: this goes to someone who just submitted their BVN through
   * Enough, not the gig marketplace, and should look like the product
   * they're actually using.
   */
  private enoughWelcomeEmailHtml(firstName: string): string {
    return `
<!doctype html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#FFF8EC;font-family:'DM Sans','Segoe UI',Arial,sans-serif;">
  <div style="max-width:480px;margin:0 auto;padding:40px 24px;">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:28px;">
      <div style="width:22px;height:22px;border-radius:50%;background:#FFC23C;border:1.5px solid #2B1B0E;display:inline-block;vertical-align:middle;"></div>
      <span style="font-family:Georgia,'Times New Roman',serif;font-weight:800;font-size:20px;color:#2B1B0E;vertical-align:middle;">enough</span>
      <span style="font-size:13px;color:#6B5843;vertical-align:middle;">by Sorted</span>
    </div>
    <div style="background:#FFFDF7;border:1px solid #F0E2C6;border-radius:20px;padding:36px 32px;">
      <p style="font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:700;color:#2B1B0E;margin:0 0 16px;">Welcome, ${firstName}.</p>
      <p style="font-size:15px;line-height:1.6;color:#6B5843;margin:0 0 16px;">
        You're opening your Enough account &mdash; the one place every naira of
        your salary gets a plan the moment it lands.
      </p>
      <p style="font-size:15px;line-height:1.6;color:#6B5843;margin:0 0 16px;">
        We're verifying your details with our banking partner right now.
        This usually takes a few minutes. Once it's done, you'll have your
        own account number &mdash; ready to receive deposits.
      </p>
      <p style="font-size:15px;line-height:1.6;color:#6B5843;margin:0;">
        Open the Enough app any time to check your status.
      </p>
    </div>
    <p style="font-size:12.5px;color:#6B5843;margin:24px 0 0;text-align:center;">Make it to payday.</p>
    <p style="font-size:11px;color:#6B5843;text-align:center;margin:12px 0 0;">Sorted Innovations Limited &middot; RC 9770241 &middot; Lagos, Nigeria</p>
  </div>
</body>
</html>`;
  }

  /** Same Enough brand as enoughWelcomeEmailHtml — see that method's doc comment. */
  private enoughDepositEmailHtml(amountDisplay: string, balanceDisplay: string): string {
    return `
<!doctype html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#FFF8EC;font-family:'DM Sans','Segoe UI',Arial,sans-serif;">
  <div style="max-width:480px;margin:0 auto;padding:40px 24px;">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:28px;">
      <div style="width:22px;height:22px;border-radius:50%;background:#FFC23C;border:1.5px solid #2B1B0E;display:inline-block;vertical-align:middle;"></div>
      <span style="font-family:Georgia,'Times New Roman',serif;font-weight:800;font-size:20px;color:#2B1B0E;vertical-align:middle;">enough</span>
      <span style="font-size:13px;color:#6B5843;vertical-align:middle;">by Sorted</span>
    </div>
    <div style="background:#FFFDF7;border:1px solid #F0E2C6;border-radius:20px;padding:36px 32px;">
      <p style="font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#9A5B00;margin:0 0 8px;">Deposit received</p>
      <p style="font-family:Georgia,'Times New Roman',serif;font-size:34px;font-weight:700;color:#2B1B0E;margin:0 0 20px;">${amountDisplay}</p>
      <div style="padding:16px 18px;background:#FFF1D1;border-radius:14px;">
        <p style="font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#9A5B00;margin:0 0 4px;">Available balance</p>
        <p style="font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:700;color:#2B1B0E;margin:0;">${balanceDisplay}</p>
      </div>
    </div>
    <p style="font-size:12.5px;color:#6B5843;margin:24px 0 0;text-align:center;">Make it to payday.</p>
    <p style="font-size:11px;color:#6B5843;text-align:center;margin:12px 0 0;">Sorted Innovations Limited &middot; RC 9770241 &middot; Lagos, Nigeria</p>
  </div>
</body>
</html>`;
  }

  /** Same Enough brand as enoughDepositEmailHtml — see that method's doc comment. */
  private enoughPaymentStatusEmailHtml(completed: boolean, amountDisplay: string, recipientAccountName: string, failureReason: string | null): string {
    const escapedName = this.escapeHtml(recipientAccountName);
    return `
<!doctype html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#FFF8EC;font-family:'DM Sans','Segoe UI',Arial,sans-serif;">
  <div style="max-width:480px;margin:0 auto;padding:40px 24px;">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:28px;">
      <div style="width:22px;height:22px;border-radius:50%;background:#FFC23C;border:1.5px solid #2B1B0E;display:inline-block;vertical-align:middle;"></div>
      <span style="font-family:Georgia,'Times New Roman',serif;font-weight:800;font-size:20px;color:#2B1B0E;vertical-align:middle;">enough</span>
      <span style="font-size:13px;color:#6B5843;vertical-align:middle;">by Sorted</span>
    </div>
    <div style="background:#FFFDF7;border:1px solid #F0E2C6;border-radius:20px;padding:36px 32px;">
      <p style="font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:${completed ? '#2E7D4F' : '#C2502A'};margin:0 0 8px;">${completed ? 'Payment sent' : 'Payment failed'}</p>
      <p style="font-family:Georgia,'Times New Roman',serif;font-size:30px;font-weight:700;color:#2B1B0E;margin:0 0 12px;">${amountDisplay}</p>
      <p style="font-size:15px;line-height:1.6;color:#6B5843;margin:0;">
        ${completed
          ? `Your payment to <strong>${escapedName}</strong> went through.`
          : `Your payment to <strong>${escapedName}</strong> didn't go through${failureReason ? ': ' + this.escapeHtml(failureReason) : '.'} The money has been credited back to your account.`}
      </p>
    </div>
    <p style="font-size:12.5px;color:#6B5843;margin:24px 0 0;text-align:center;">Make it to payday.</p>
    <p style="font-size:11px;color:#6B5843;text-align:center;margin:12px 0 0;">Sorted Innovations Limited &middot; RC 9770241 &middot; Lagos, Nigeria</p>
  </div>
</body>
</html>`;
  }

  private enoughTransfersEnabledEmailHtml(): string {
    return `
<!doctype html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#FFF8EC;font-family:'DM Sans','Segoe UI',Arial,sans-serif;">
  <div style="max-width:480px;margin:0 auto;padding:40px 24px;">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:28px;">
      <div style="width:22px;height:22px;border-radius:50%;background:#FFC23C;border:1.5px solid #2B1B0E;display:inline-block;vertical-align:middle;"></div>
      <span style="font-family:Georgia,'Times New Roman',serif;font-weight:800;font-size:20px;color:#2B1B0E;vertical-align:middle;">enough</span>
      <span style="font-size:13px;color:#6B5843;vertical-align:middle;">by Sorted</span>
    </div>
    <div style="background:#FFFDF7;border:1px solid #F0E2C6;border-radius:20px;padding:36px 32px;">
      <p style="font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#2E7D4F;margin:0 0 8px;">Ready</p>
      <p style="font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:700;color:#2B1B0E;margin:0 0 12px;">Make a payment is ready</p>
      <p style="font-size:15px;line-height:1.6;color:#6B5843;margin:0;">
        Bank transfers are now turned on for your Enough account. You can send a payment from your landing spot or any purpose, any time.
      </p>
    </div>
    <p style="font-size:12.5px;color:#6B5843;margin:24px 0 0;text-align:center;">Make it to payday.</p>
    <p style="font-size:11px;color:#6B5843;text-align:center;margin:12px 0 0;">Sorted Innovations Limited &middot; RC 9770241 &middot; Lagos, Nigeria</p>
  </div>
</body>
</html>`;
  }

  /**
   * PLAN.md "Direct-invite email redesign" — visual design supplied by the
   * founder (built elsewhere, handed over as a screenshot), reproduced here
   * with two corrections against what's actually true of this codebase
   * rather than copied verbatim (a third guess — the footer's company
   * details — turned out to be the mock's own, confirmed correct: "Sorted
   * Innovations Limited · RC 9770241" is the real entity, not
   * index.html's "Reforma Digital Solutions Limited" footer, which is
   * apparently stale/wrong and flagged separately, not fixed here):
   *   1. The mock's "We hold the money and pay you once the job is done"
   *      line describes the pre-pivot escrow model — Paystack declined
   *      that (see PLAN.md "Split payment pivot"). Replaced with the same
   *      "nothing's charged until approval, paid the same moment" language
   *      index.html already uses.
   *   2. The mock's "When: Pickup Tue 30 Sept, 4–6pm" row has no backing
   *      data — Gig has no scheduled-time field. Swapped for "Category"
   *      (the gig's submarket label), which is real and keeps the
   *      three-row layout.
   * The mock's one-click "Decline here" link implies a signed, no-login
   * magic link (new backend surface, real security tradeoffs to get
   * right) that doesn't exist yet — both the primary and secondary CTA
   * point at the site for now; see PLAN.md for the follow-up.
   */
  private inviteEmailHtml(gigId: string, clientName: string, gigDescription: string, submarketLabel: string, locationText: string, bountyKobo: number): string {
    // &#8358; (₦), not the literal glyph — every other template here uses
    // HTML entities for non-ASCII (&mdash;, &ldquo;, ...) rather than
    // relying on a charset declaration email clients may strip; found via
    // a rendered screenshot showing "â‚¦" mojibake before that fix.
    const amountNaira = '&#8358;' + (bountyKobo / 100).toLocaleString('en-NG', { maximumFractionDigits: 0 });
    const clientFirstName = this.escapeHtml(clientName.trim().split(/\s+/)[0] || clientName);
    const description = this.escapeHtml(gigDescription);
    const category = this.escapeHtml(submarketLabel);
    const location = this.escapeHtml(locationText);
    // Real bug, fixed — this used to be a bare "https://sorted.com.ng" with
    // no gig reference at all, so there was no way to actually respond from
    // the email. /app/cleaner/request/[id] is the real accept/decline
    // screen (confirmed against the AFRICA repo's Expo Router + its
    // vercel.json rewrite, which is what makes this exact path work on the
    // sorted.com.ng/app deployment) — it reads a gig by id and renders
    // Accept/Decline for any gig still in 'open' status, which an
    // unanswered invite always is. Only works for an already-logged-in
    // professional — there's no logged-out deep-link redirect in the app
    // yet (separate, unfixed gap, not this template's job).
    const respondUrl = `https://sorted.com.ng/app/cleaner/request/${encodeURIComponent(gigId)}`;

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
        <a href="${respondUrl}" style="display:block;text-align:center;background:#027A61;color:#FFFFFF;font-size:15px;font-weight:700;padding:15px 0;border-radius:12px;text-decoration:none;">Open Sorted to respond &rarr;</a>
        <p style="text-align:center;font-size:12px;color:#7E8F8D;margin:14px 0 0;">Can't take this job? <a href="${respondUrl}" style="color:#027A61;font-weight:700;text-decoration:underline;">Open Sorted</a> to let us know, so we can offer it to someone else.</p>
      </div>

      <div style="margin:0 28px 28px;padding:16px 18px;border:1px dashed #E0E6E4;border-radius:12px;">
        <p style="font-size:12.5px;font-weight:700;color:#0C1F1B;margin:0 0 4px;">Faster on WhatsApp?</p>
        <p style="font-size:12.5px;line-height:1.5;color:#3A4A47;margin:0;">If you've messaged Sorted before, just reply on that same thread with <strong>YES</strong> to accept or <strong>NO</strong> to decline.</p>
      </div>
    </div>

    <p style="font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:15px;color:#027A61;text-align:center;margin:24px 0 6px;">Consider it sorted.</p>
    <p style="font-size:11.5px;color:#7E8F8D;text-align:center;margin:0 0 4px;">You're getting this because a client booked you directly on Sorted.</p>
    <p style="font-size:11.5px;color:#7E8F8D;text-align:center;margin:0 0 14px;"><a href="https://sorted.com.ng" style="color:#7E8F8D;text-decoration:underline;">sorted.com.ng</a></p>
    <p style="font-size:11px;color:#7E8F8D;text-align:center;margin:0;line-height:1.5;">Sorted Innovations Limited &middot; RC 9770241 &middot; Lagos, Nigeria</p>
  </div>
</body>
</html>`;
  }

  /**
   * PLAN.md "Daily founder briefing email" — same visual language as
   * inviteEmailHtml (same colors/fonts), a KPI table per section instead
   * of a job summary. Every number here is server-computed from data the
   * product already writes (digest.service.ts) — nothing estimated.
   */
  private founderDigestEmailHtml(event: Extract<NotificationEvent, { kind: 'founder_daily_digest' }>): string {
    const naira = (kobo: number) => '&#8358;' + (kobo / 100).toLocaleString('en-NG', { maximumFractionDigits: 0 });
    const row = (label: string, value: string, isLast?: boolean) => `
          <tr>
            <td style="padding:12px 14px;font-size:13px;color:#3A4A47;${isLast ? '' : 'border-bottom:1px solid #E0E6E4;'}">${label}</td>
            <td style="padding:12px 14px;font-size:14px;font-weight:700;color:#0C1F1B;text-align:right;${isLast ? '' : 'border-bottom:1px solid #E0E6E4;'}">${value}</td>
          </tr>`;
    const section = (title: string, rowsHtml: string) => `
      <div style="padding:0 28px 22px;">
        <p style="font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#7E8F8D;margin:0 0 8px;">${title}</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#F4FAF8;border-radius:12px;">${rowsHtml}
        </table>
      </div>`;

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
      <div style="background:#027A61;padding:22px 28px 18px;">
        <span style="display:inline-block;background:rgba(255,255,255,0.18);color:#FFFFFF;font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;padding:5px 12px;border-radius:999px;margin:0 0 12px;">Daily briefing</span>
        <p style="font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:700;color:#FFFFFF;margin:4px 0 0;line-height:1.3;">${event.periodLabel}</p>
      </div>

      <div style="padding:22px 28px 4px;">
        <p style="font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#7E8F8D;margin:0 0 6px;">Fee revenue</p>
        <p style="font-family:Georgia,'Times New Roman',serif;font-size:30px;font-weight:700;color:#027A61;margin:0 0 4px;">${naira(event.feeRevenueKobo)}</p>
        <p style="font-size:12px;line-height:1.5;color:#7E8F8D;margin:0 0 18px;">From ${event.transactionsCompletedCount} completed transaction${event.transactionsCompletedCount === 1 ? '' : 's'} worth ${naira(event.transactionsCompletedValueKobo)} total.</p>
      </div>

      ${section('Traffic', row('Site visits', String(event.pageviews)) + row('WhatsApp clicks', String(event.whatsappClicks), true))}
      ${section(
        'New signups',
        row('Clients', String(event.newClientSignups)) + row('Professionals', String(event.newProfessionalSignups), true),
      )}
      ${section(
        'Orders & money',
        row('Orders placed', `${event.ordersPlacedCount} &middot; ${naira(event.ordersPlacedValueKobo)}`) +
          row('Transactions completed', `${event.transactionsCompletedCount} &middot; ${naira(event.transactionsCompletedValueKobo)}`, true),
      )}
      ${section(
        'Trust & ops',
        row('Disputes opened', String(event.disputesOpened)) +
          row('KYC applications submitted', String(event.kycApplicationsSubmitted)) +
          row('Delivery dispatch failures', String(event.deliveryFailures), true),
      )}

      <div style="padding:4px 28px 24px;">
        <a href="https://sorted.com.ng/dashboard.html" style="display:block;text-align:center;background:#027A61;color:#FFFFFF;font-size:14px;font-weight:700;padding:14px 0;border-radius:12px;text-decoration:none;">Open the full dashboard &rarr;</a>
      </div>
    </div>

    <p style="font-size:11.5px;color:#7E8F8D;text-align:center;margin:24px 0 4px;">Automated daily briefing &mdash; not sent to clients or professionals.</p>
    <p style="font-size:11px;color:#7E8F8D;text-align:center;margin:0;line-height:1.5;">Sorted Innovations Limited &middot; RC 9770241 &middot; Lagos, Nigeria</p>
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
