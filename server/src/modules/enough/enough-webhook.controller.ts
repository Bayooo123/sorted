import { Controller, Headers, HttpCode, Inject, Logger, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { EnoughAccountsService } from './enough-accounts.service';
import { BACHS_CONNECT_ACCOUNT_PORT, BachsConnectAccountPort } from './enough.interface';

interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

/**
 * PLAN.md "Enough: Bachs Connect account per signup" — a SEPARATE webhook
 * endpoint from server/src/modules/escrow/bachs-webhook.controller.ts,
 * registered with event_source: "connect" (see "Monitor onboarding"), with
 * its own signing_secret (BACHS_CONNECT_WEBHOOK_SECRET) and its own
 * event_types (account.updated, capability.updated, collection.succeeded).
 * Same non-negotiables as the escrow one: always 200 once the signature
 * check has run, never rethrow as a non-2xx, so Bachs' retry schedule
 * never spins forever on an event we're deliberately ignoring.
 */
@Controller('webhooks/bachs-connect')
export class EnoughWebhookController {
  private readonly logger = new Logger(EnoughWebhookController.name);

  constructor(
    private readonly accounts: EnoughAccountsService,
    @Inject(BACHS_CONNECT_ACCOUNT_PORT) private readonly bachs: BachsConnectAccountPort,
  ) {}

  @Post()
  @HttpCode(200)
  async handle(@Req() req: RequestWithRawBody, @Headers() headers: Record<string, string>) {
    const { valid, payload } = this.bachs.verifyWebhook(req.rawBody ?? Buffer.alloc(0), headers);
    if (!valid) {
      this.logger.warn('Bachs Connect webhook signature verification failed — ignoring');
      return { received: true };
    }

    const event = payload as {
      id?: string;
      type?: string;
      account?: string;
      organization_id?: string;
      data?: Record<string, unknown>;
    };

    try {
      if (event.type === 'capability.updated' && event.data?.capability === 'virtual_accounts') {
        const accountId = event.account ?? event.organization_id;
        const status = event.data.status as string | undefined;
        if (accountId && status) {
          await this.accounts.handleCapabilityUpdated(accountId, status, null);
        }
      } else if (event.type === 'collection.succeeded' && event.data && event.data.checkout_id == null) {
        const accountId = event.organization_id;
        const eventId = event.id;
        const chargeId = event.data.charge_id as string | undefined;
        const settlementAmount = event.data.settlement_amount as string | undefined;
        if (accountId && eventId && chargeId && settlementAmount) {
          const amountKobo = BigInt(Math.round(Number(settlementAmount) * 100));
          await this.accounts.handleDeposit(eventId, accountId, chargeId, amountKobo);
        }
      }
      // account.updated is intentionally a no-op here — this first pass
      // doesn't render a requirements screen, only waits on
      // capability.updated. Revisit if Enough ever needs to show
      // "here's specifically what's still missing" instead of a generic
      // wait state.
    } catch (err) {
      this.logger.error(`Failed to process Bachs Connect event ${event.type}: ${err instanceof Error ? err.message : err}`);
    }

    return { received: true };
  }
}
