import { Controller, Headers, HttpCode, Inject, Logger, Post, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { PAYMENTS_PROVIDER, PaymentsProvider } from '../payments/payments.interface';
import { EscrowService } from './escrow.service';

interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

/**
 * Paystack calls this directly — no JwtAuthGuard/AdminGuard, verified
 * instead via HMAC signature (PaystackProvider.verifyWebhook). This is
 * what actually automates funding confirmation: EscrowService.
 * confirmFunding's doc comment already anticipated this exact shape
 * ("called by a Payments webhook handler after verifyWebhook() passes").
 *
 * Non-negotiables from HANDOFF.md §9 / escrow.service.ts's doc comment —
 * IP-allowlist + signature verification + idempotency on event_id, all
 * present in this one change:
 *   - signature verification: PaystackProvider.verifyWebhook (the real
 *     guarantee);
 *   - IP-allowlist: soft/logged only, see the doc comment on
 *     verifyWebhook for why it isn't a hard gate here;
 *   - idempotency: EscrowService.confirmFunding's own state-guard +
 *     LedgerEntry.eventId upsert — a replayed webhook (Paystack retries
 *     on anything but 2xx) is already a safe no-op, nothing new needed
 *     in this controller.
 *
 * Always responds 200 once the signature check has run, even for an
 * invalid signature or an event kind we don't act on — Paystack retries
 * on non-2xx, and retrying an event we're deliberately ignoring forever
 * is noise, not a fix. An invalid signature is logged, not retried-into.
 */
@Controller('webhooks/paystack')
export class PaystackWebhookController {
  private readonly logger = new Logger(PaystackWebhookController.name);

  constructor(
    private readonly escrow: EscrowService,
    private readonly config: ConfigService,
    @Inject(PAYMENTS_PROVIDER) private readonly payments: PaymentsProvider,
  ) {}

  @Post()
  @HttpCode(200)
  async handle(@Req() req: RequestWithRawBody, @Headers() headers: Record<string, string>) {
    this.warnIfIpNotAllowlisted(req);

    const result = await this.payments.verifyWebhook(req.rawBody ?? Buffer.alloc(0), headers);
    if (!result.valid) {
      this.logger.warn('Paystack webhook signature verification failed — ignoring');
      return { received: true };
    }

    const event = result.payload as { event: string; data?: { reference?: string; id?: number | string } };

    if (event.event === 'charge.success' && event.data?.reference) {
      const providerRef = event.data.id != null ? String(event.data.id) : event.data.reference;
      try {
        await this.escrow.confirmFunding(event.data.reference, providerRef);
      } catch (err) {
        // Logged, not rethrown as a non-2xx — see the class doc comment
        // on why we don't want Paystack retrying this forever. A gigId
        // that no longer matches an EscrowRecord (e.g. a stale/replayed
        // reference) ends up here, not as a crash.
        this.logger.error(
          `Failed to confirm funding for gig ${event.data.reference}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    // Every other event kind (transfer.success, refund.processed, ...) is
    // intentionally a no-op until disburse/refund have real callers
    // (slices 7/8) — acknowledged, not acted on.

    return { received: true };
  }

  private warnIfIpNotAllowlisted(req: RequestWithRawBody): void {
    const allowlist = this.config.get<string>('PAYSTACK_WEBHOOK_IP_ALLOWLIST');
    if (!allowlist) return;
    const allowed = allowlist.split(',').map((ip) => ip.trim());
    const sourceIp = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.ip;
    if (sourceIp && !allowed.includes(sourceIp)) {
      this.logger.warn(`Paystack webhook from IP not on PAYSTACK_WEBHOOK_IP_ALLOWLIST: ${sourceIp}`);
    }
  }
}
