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
   * window this logs a warning and does NOT send (no approved template
   * message exists yet — see PLAN.md) rather than throwing, since a
   * failed notification must never fail the caller's real action (e.g.
   * signup already succeeded before this is called).
   */
  sendMessage(phone: string, text: string): Promise<void>;
  /** Called by WhatsappWebhookController for every inbound message, so sendMessage knows the 24h window is open. */
  recordInboundMessage(phone: string): Promise<void>;
}

export const WHATSAPP_PORT = 'WHATSAPP_PORT';
