import { Controller, Headers, HttpCode, Logger, Post, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { EnoughAccountsService } from './enough-accounts.service';
import { EnoughPaymentsService } from './enough-payments.service';
import { verifyNombaWebhookSignature } from './providers/nomba-signature.util';

interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

/**
 * PLAN.md "Nomba integration" — a SINGLE webhook endpoint for every Nomba
 * event, unlike Bachs' three separately-registered ones (webhooks/bachs,
 * webhooks/bachs-connect, webhooks/bachs-payouts). Nomba's dashboard has
 * one webhook URL + one signature key for the whole business account, and
 * every subscribed event type arrives here with an `event_type` field to
 * dispatch on — see providers/nomba-signature.util.ts for the exact
 * verification scheme. Same non-negotiable as every other webhook
 * controller in this codebase: always 200 once the signature check has
 * run, never rethrow as a non-2xx, so Nomba's retry schedule never spins
 * forever on an event we're deliberately ignoring.
 *
 * Only registered/consumed when ENOUGH_PROVIDER_KEY=nomba — see
 * enough.module.ts. Harmless to leave mounted either way: with no
 * NOMBA_WEBHOOK_SECRET configured, verifyNombaWebhookSignature always
 * returns invalid and every event is logged-and-ignored.
 */
@Controller('webhooks/nomba')
export class NombaWebhookController {
  private readonly logger = new Logger(NombaWebhookController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly accounts: EnoughAccountsService,
    private readonly payments: EnoughPaymentsService,
  ) {}

  @Post()
  @HttpCode(200)
  async handle(@Req() req: RequestWithRawBody, @Headers() headers: Record<string, string>) {
    const { valid, payload } = verifyNombaWebhookSignature(req.rawBody ?? Buffer.alloc(0), headers, this.config.get<string>('NOMBA_WEBHOOK_SECRET'));
    if (!valid) {
      this.logger.warn('Nomba webhook signature verification failed — ignoring');
      return { received: true };
    }

    const event = payload as {
      event_type?: string;
      requestId?: string;
      data?: {
        transaction?: {
          transactionId?: string;
          type?: string;
          transactionAmount?: number;
          aliasAccountReference?: string;
          narration?: string;
        };
      };
    };
    const transaction = event.data?.transaction;

    try {
      if (event.event_type === 'payment_success' && transaction?.type === 'vact_transfer') {
        // A deposit into one of our virtual accounts. aliasAccountReference
        // is the accountRef we set when creating it in
        // NombaConnectAccountProvider.submitRepresentative — the same
        // value stored as EnoughAccount.bachsAccountId, so this is a
        // drop-in match for EnoughAccountsService.handleDeposit's existing
        // lookup, no changes needed there.
        if (event.requestId && transaction.aliasAccountReference && transaction.transactionId && transaction.transactionAmount != null) {
          const amountKobo = BigInt(Math.round(transaction.transactionAmount * 100));
          await this.accounts.handleDeposit(event.requestId, transaction.aliasAccountReference, transaction.transactionId, amountKobo);
        }
      } else if (event.event_type === 'payout_success' && transaction?.transactionId) {
        await this.payments.handlePayoutWebhook(transaction.transactionId, true, null);
      } else if (event.event_type === 'payout_failed' && transaction?.transactionId) {
        await this.payments.handlePayoutWebhook(transaction.transactionId, false, transaction.narration ?? 'Payout failed at the bank.');
      }
      // payment_failed/payment_reversal (collection side) and payout_refund
      // are intentionally no-ops here: payout_refund specifically needs a
      // deliberate "trigger a refund to the client" product decision this
      // codebase hasn't made yet (Nomba's own docs warn not to refund on
      // payout_failed alone) — flagged, not silently assumed.
    } catch (err) {
      this.logger.error(`Failed to process Nomba event ${event.event_type}: ${err instanceof Error ? err.message : err}`);
    }

    return { received: true };
  }
}
