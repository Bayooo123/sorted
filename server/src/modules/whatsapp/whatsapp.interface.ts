/**
 * Product decision, not in HANDOFF.md — see PLAN.md "WhatsApp integration".
 *
 * Deliberately lean: this port has NO Identity dependency, on purpose.
 * IdentityModule already imports ReputationNotificationsModule (for
 * notify()); if Notifications also needs to send a WhatsApp message on
 * signup, and WhatsApp needed IdentityModule too, that's a cycle
 * (Identity -> Notifications -> Whatsapp -> Identity). Splitting the
 * inbound webhook (which DOES need Identity, to look up registered users
 * by phone) into a separate WhatsappWebhookModule — imported only by
 * AppModule, imported by nothing else — breaks that cycle. See
 * whatsapp-webhook.module.ts's doc comment for the other half.
 */

export interface WhatsAppPort {
  /**
   * Free-form text only works within Meta's 24h customer-service window
   * (the phone must have messaged us within the last 24h) — enforced
   * internally via WhatsAppSession, not by the caller. Outside that
   * window this logs a warning and does NOT send rather than throwing,
   * since a failed notification must never fail the caller's real action
   * (e.g. signup already succeeded before this is called). For a case
   * that genuinely needs to reach someone outside the window (the direct-
   * invite notification — PLAN.md "WhatsApp integration, Phase 3.1"),
   * check isSessionOpen first and use sendTemplate as the outside-window
   * path instead of calling this blind.
   */
  sendMessage(phone: string, text: string): Promise<void>;
  /** Called by WhatsappWebhookController for every inbound message, so sendMessage knows the 24h window is open. */
  recordInboundMessage(phone: string): Promise<void>;
  /** Same window check sendMessage does internally, exposed so a caller can decide sendMessage vs. sendTemplate BEFORE attempting either. */
  isSessionOpen(phone: string): Promise<boolean>;
  /**
   * Meta-approved template message — the only way to reach a phone outside
   * the 24h window. `templateName`/`languageCode` must match a template
   * already APPROVED in Meta's WhatsApp Manager (external, manual,
   * multi-day process — see PLAN.md); returns false (not a thrown error)
   * if the template isn't configured or Meta rejects the send, so callers
   * can fall back to telling a human rather than failing silently.
   */
  sendTemplate(phone: string, templateName: string, languageCode: string, bodyParams: string[]): Promise<boolean>;
  /**
   * Puts `clientPhone`'s WhatsAppSession into the "who else should get
   * this job" follow-up (PLAN.md Phase 3.1) and sends `reasonText` plus
   * the OPEN/new-number prompt — the one piece of conversation-state logic
   * this lean module owns, because it's needed from EscrowService (which
   * cannot depend on WhatsappGigConversationService without a cycle — see
   * whatsapp-webhook.module.ts) as well as from WhatsappInviteService.
   */
  offerReassignment(clientPhone: string, gigId: string, reasonText: string): Promise<void>;
}

export const WHATSAPP_PORT = 'WHATSAPP_PORT';
