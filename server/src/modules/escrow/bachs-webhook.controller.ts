import { Controller, Headers, HttpCode, Inject, Logger, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { PAYMENTS_PROVIDER, PaymentsProvider } from '../payments/payments.interface';
import { EscrowService } from './escrow.service';

interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

/**
 * PLAN.md "Bachs payment integration" — Bachs' counterpart to
 * PaystackWebhookController, same structure and same non-negotiables (see
 * that file's doc comment): no JwtAuthGuard/AdminGuard, verified instead
 * via BachsProvider.verifyWebhook's HMAC check; idempotency comes from
 * EscrowService.confirmRelease's own state-guard + LedgerEntry.eventId
 * upsert, nothing new needed here; always 200s once the signature check
 * has run so Bachs' retry schedule (5 retries over ~80 minutes, endpoint
 * auto-disabled after 72h of consecutive failures — per "Setting Up
 * Webhooks") never spins forever on an event we're deliberately ignoring.
 *
 * UNVERIFIED: the `collection.succeeded` event's exact data-field names
 * for the charge reference (assumed data.reference, matching the
 * `reference` this provider sets when creating the checkout session) and
 * the provider-side payment id (assumed data.id) — never fetched a
 * dedicated event-payload reference page for this specific event type.
 * Confirm both against a real webhook delivery (Bachs' dashboard can
 * replay a test event) before relying on this in production.
 */
@Controller('webhooks/bachs')
export class BachsWebhookController {
  private readonly logger = new Logger(BachsWebhookController.name);

  constructor(
    private readonly escrow: EscrowService,
    @Inject(PAYMENTS_PROVIDER) private readonly payments: PaymentsProvider,
  ) {}

  @Post()
  @HttpCode(200)
  async handle(@Req() req: RequestWithRawBody, @Headers() headers: Record<string, string>) {
    const result = await this.payments.verifyWebhook(req.rawBody ?? Buffer.alloc(0), headers);
    if (!result.valid) {
      this.logger.warn('Bachs webhook signature verification failed — ignoring');
      return { received: true };
    }

    const event = result.payload as { type: string; data?: { reference?: string; id?: string } };

    if (event.type === 'collection.succeeded' && event.data?.reference) {
      const providerRef = event.data.id ?? event.data.reference;
      try {
        await this.escrow.confirmRelease(event.data.reference, providerRef);
      } catch (err) {
        // Logged, not rethrown as a non-2xx — see this class's doc
        // comment on why we don't want Bachs retrying this forever.
        this.logger.error(
          `Failed to confirm release for gig ${event.data.reference}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    // Every other event kind is intentionally a no-op, same as
    // PaystackWebhookController — acknowledged, not acted on, until
    // disburse/refund have real callers.

    return { received: true };
  }
}
