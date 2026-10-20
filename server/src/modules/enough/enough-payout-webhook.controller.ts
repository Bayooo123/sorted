import { Controller, Headers, HttpCode, Inject, Logger, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { EnoughPaymentsService } from './enough-payments.service';
import { BACHS_PAYOUT_PORT, BachsPayoutPort } from './enough.interface';

interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

/**
 * PLAN.md "Enough: Make Payment" — a THIRD separate Bachs webhook
 * endpoint (alongside /webhooks/bachs and /webhooks/bachs-connect), for
 * payout.paid/payout.failed — platform-level events, not Connect events,
 * per BachsPayoutProvider's doc comment. Needs its own registration in
 * Bachs' dashboard with its own signing_secret (BACHS_PAYOUTS_WEBHOOK_SECRET).
 * Same non-negotiable as the other two: always 200 once the signature
 * check has run, never rethrow as a non-2xx.
 */
@Controller('webhooks/bachs-payouts')
export class EnoughPayoutWebhookController {
  private readonly logger = new Logger(EnoughPayoutWebhookController.name);

  constructor(
    private readonly payments: EnoughPaymentsService,
    @Inject(BACHS_PAYOUT_PORT) private readonly bachs: BachsPayoutPort,
  ) {}

  @Post()
  @HttpCode(200)
  async handle(@Req() req: RequestWithRawBody, @Headers() headers: Record<string, string>) {
    const { valid, payload } = this.bachs.verifyWebhook(req.rawBody ?? Buffer.alloc(0), headers);
    if (!valid) {
      this.logger.warn('Bachs payouts webhook signature verification failed — ignoring');
      return { received: true };
    }

    const event = payload as { type?: string; data?: { withdrawal_id?: string; rejection_reason?: string } };

    try {
      if (event.type === 'payout.paid' && event.data?.withdrawal_id) {
        await this.payments.handlePayoutWebhook(event.data.withdrawal_id, true, null);
      } else if (event.type === 'payout.failed' && event.data?.withdrawal_id) {
        await this.payments.handlePayoutWebhook(event.data.withdrawal_id, false, event.data.rejection_reason ?? null);
      }
      // payout.created is intentionally a no-op — initiatePayment already
      // has the withdrawal id from the synchronous create call.
    } catch (err) {
      this.logger.error(`Failed to process Bachs payouts event ${event.type}: ${err instanceof Error ? err.message : err}`);
    }

    return { received: true };
  }
}
