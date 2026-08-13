/**
 * HANDOFF.md §3.9 — Notifications
 * Owns: OTP, gig/escrow/dispute events.
 *
 * SEAM: channel-agnostic. SMS in v1; push/WhatsApp/email are added channels
 * behind the same notify() call — callers never branch on channel.
 */

export type NotificationEvent =
  | { kind: 'otp'; code: string }
  | { kind: 'gig_funded'; gigId: string }
  | { kind: 'gig_claimed'; gigId: string }
  | { kind: 'escrow_released'; gigId: string }
  | { kind: 'dispute_raised'; gigId: string; disputeId: string }
  | { kind: 'dispute_ruled'; gigId: string; disputeId: string };

export interface NotificationsPort {
  notify(userId: string, event: NotificationEvent): Promise<void>;
}
