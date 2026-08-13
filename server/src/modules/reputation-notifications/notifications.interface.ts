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

/**
 * Where to deliver a notification. userId is carried for logging/audit —
 * the actual delivery address (phone, and later push token / email) is
 * supplied by the caller, not resolved by Notifications itself. Notifications
 * has no Prisma access to User (Identity owns that table); if it needed to
 * look up a phone number from a userId, it would either read Identity's
 * table directly (forbidden — HANDOFF.md §9, "no cross-module table
 * access") or import IdentityModule and create a circular dependency
 * (IdentityModule already imports this module to send OTPs). Pushing the
 * destination up to the caller, who already has it, avoids both.
 */
export interface NotifyTarget {
  userId: string;
  phone: string;
}

export interface NotificationsPort {
  notify(target: NotifyTarget, event: NotificationEvent): Promise<void>;
}

export const NOTIFICATIONS_PORT = 'NOTIFICATIONS_PORT';
