/**
 * HANDOFF.md §3.9 — Notifications
 * Owns: gig/escrow/dispute events, plus the post-signup welcome email and
 * the password-reset code email (product decisions, not in HANDOFF.md —
 * the only implemented event kinds right now; see PLAN.md "Welcome email
 * on signup" and "Forgot password"). Previously also OTP delivery, dropped
 * when auth moved to email/phone + password (see PLAN.md "Password-based
 * auth").
 *
 * SEAM: channel-agnostic. SMS in v1; push/WhatsApp/email are added channels
 * behind the same notify() call — callers never branch on channel.
 */

export type NotificationEvent =
  | { kind: 'user_signed_up'; name: string }
  | { kind: 'password_reset_requested'; code: string }
  /**
   * PLAN.md "Enough: Bachs Connect account per signup" — fired once, right
   * after EnoughAccountsService.submitIdentity creates the EnoughAccount
   * row (the actual "signed up for Enough" moment — distinct from the base
   * Sorted 'user_signed_up' email above, which both products' signup forms
   * trigger and which only talks about the gig marketplace).
   */
  | { kind: 'enough_account_opened'; name: string }
  /**
   * PLAN.md "Enough: Bachs Connect account per signup" — fired from
   * EnoughAccountsService.handleDeposit right after a collection.succeeded
   * webhook credits the account, so a deposit shows up in the user's inbox
   * as fast as Bachs' own webhook delivery, not on their next app open.
   */
  | { kind: 'enough_deposit_received'; amountKobo: number; availableBalanceKobo: string }
  /**
   * PLAN.md "Enough: Make Payment" — fired from
   * EnoughPaymentsService.handlePayoutWebhook once Bachs' payout webhook
   * resolves a payment one way or the other; a synchronous failure in
   * initiatePayment itself is surfaced directly in the API response, not
   * an email.
   */
  | { kind: 'enough_payment_status_changed'; completed: boolean; amountKobo: number; recipientAccountName: string; failureReason: string | null }
  /**
   * PLAN.md "Enough: Make Payment" — fired from
   * EnoughAccountsService.handleTransfersCapabilityUpdated the first time
   * Bachs' capability.updated webhook reports the transfers capability
   * (recipient persona) as active, i.e. the moment Make Payment actually
   * becomes usable for this account. Confirmed with Bachs support: an
   * empty requirements list does NOT mean this moment has arrived — only
   * this webhook (or a live call) does, so a user who hit the "not yet
   * turned on, try again" message has no other way to know when it's
   * actually safe to retry without this email.
   */
  | { kind: 'enough_transfers_enabled' }
  | { kind: 'gig_funded'; gigId: string }
  | { kind: 'gig_claimed'; gigId: string }
  | { kind: 'escrow_released'; gigId: string }
  | { kind: 'dispute_raised'; gigId: string; disputeId: string }
  | { kind: 'dispute_ruled'; gigId: string; disputeId: string }
  /**
   * PLAN.md "Direct-invite email notification" — a client hired this
   * professional by name (Directory "Hire" flow, GigsService.sendInvite).
   * Email only; the WhatsApp side of a direct invite is stateful (needs
   * WhatsAppSession.pendingInviteGigId for the YES/NO reply) and stays
   * owned by GigsService.sendJobMessage rather than moving through this
   * generic port.
   */
  | {
      kind: 'professional_invited';
      /** Real bug, fixed — the email's CTA had no gig reference at all and pointed at the bare homepage. See notifications.service.ts's inviteEmailHtml. */
      gigId: string;
      clientName: string;
      gigDescription: string;
      submarketLabel: string;
      locationText: string;
      bountyKobo: number;
    }
  /**
   * PLAN.md "Daily founder briefing email" — one email per recipient in
   * FOUNDER_DIGEST_RECIPIENTS, sent by a daily cron (see
   * digest.service.ts). All figures cover the previous full UTC calendar
   * day. Not tied to a specific User — DigestCronController passes a
   * synthetic NotifyTarget per recipient (see that controller's own
   * comment for why).
   */
  | {
      kind: 'founder_daily_digest';
      periodLabel: string; // e.g. "Monday, 13 October 2026"
      pageviews: number;
      whatsappClicks: number;
      newClientSignups: number;
      newProfessionalSignups: number;
      ordersPlacedCount: number;
      ordersPlacedValueKobo: number;
      transactionsCompletedCount: number;
      transactionsCompletedValueKobo: number;
      feeRevenueKobo: number;
      disputesOpened: number;
      kycApplicationsSubmitted: number;
      deliveryFailures: number;
    };

/**
 * Where to deliver a notification. userId is carried for logging/audit —
 * the actual delivery address (phone/email, and later push token) is
 * supplied by the caller, not resolved by Notifications itself. Notifications
 * has no Prisma access to User (Identity owns that table); if it needed to
 * look up a phone/email from a userId, it would either read Identity's
 * table directly (forbidden — HANDOFF.md §9, "no cross-module table
 * access") or import IdentityModule and create a circular dependency.
 * Pushing the destination up to the caller, who already has it, avoids both.
 */
export interface NotifyTarget {
  userId: string;
  phone?: string;
  email?: string;
}

export interface NotificationsPort {
  notify(target: NotifyTarget, event: NotificationEvent): Promise<void>;
}

export const NOTIFICATIONS_PORT = 'NOTIFICATIONS_PORT';
