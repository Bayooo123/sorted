import { Controller, HttpCode, Inject, Logger, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { EnoughAccountsService } from './enough-accounts.service';
import { BACHS_CONNECT_ACCOUNT_PORT, BachsConnectAccountPort } from './enough.interface';

interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

/**
 * PLAN.md "Paga integration" — Paga's deposit callback for a persistent
 * payment identifier. A separate route from /webhooks/bachs-connect and
 * /webhooks/nomba (same reasoning as Nomba getting its own controller
 * instead of reusing Bachs': the payload shapes aren't related). This
 * is the URL to register with Paga as the persistent payment account's
 * callbackUrl (or set as the account-wide default in the Paga dashboard
 * if that's how it's configured).
 *
 * Confirmed payload shape (Persistent Payment Identifier page, pasted
 * 2026-10-30): statusCode, statusMessage, transactionReference,
 * fundingPaymentReference, accountNumber, accountName,
 * financialIdentificationNumber, amount, clearingFeeAmount,
 * payerDetails, hash. accountNumber is Paga's real issued bank account
 * number — which IS EnoughAccount.bachsAccountId for Paga accounts, see
 * PagaConnectAccountProvider's doc comment on why. transactionReference
 * is used as both the dedup key (EnoughDepositEvent.id) and the stored
 * chargeId — Paga's callback doesn't give two independent ids the way
 * Nomba's (requestId + transactionId) or Bachs' (event id + charge_id)
 * do.
 *
 * Same non-negotiable as every other webhook controller in this
 * codebase: always 200 once the signature check has run, never rethrow
 * as a non-2xx, so Paga's retry schedule (confirmed: 3 fast retries,
 * then every 5 minutes for 30 minutes) never spins forever on an event
 * we're deliberately ignoring.
 */
@Controller('webhooks/paga')
export class PagaWebhookController {
  private readonly logger = new Logger(PagaWebhookController.name);

  constructor(
    private readonly accounts: EnoughAccountsService,
    @Inject(BACHS_CONNECT_ACCOUNT_PORT) private readonly paga: BachsConnectAccountPort,
  ) {}

  @Post()
  @HttpCode(200)
  async handle(@Req() req: RequestWithRawBody) {
    const { valid, payload } = this.paga.verifyWebhook(req.rawBody ?? Buffer.alloc(0), {});
    if (!valid) {
      this.logger.warn('Paga deposit callback failed basic validation — ignoring');
      return { received: true };
    }

    const event = payload as {
      statusCode?: string;
      transactionReference?: string;
      fundingPaymentReference?: string | null;
      accountNumber?: string;
      amount?: string;
    };

    try {
      if (event.statusCode === '0' && event.transactionReference && event.accountNumber && event.amount != null) {
        const amountKobo = BigInt(Math.round(Number(event.amount) * 100));
        const chargeId = event.fundingPaymentReference || event.transactionReference;
        await this.accounts.handleDeposit(event.transactionReference, event.accountNumber, chargeId, amountKobo);
      }
    } catch (err) {
      this.logger.error(`Failed to process Paga deposit callback: ${err instanceof Error ? err.message : err}`);
    }

    return { received: true };
  }
}
