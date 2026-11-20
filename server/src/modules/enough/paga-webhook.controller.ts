import { Controller, Headers, HttpCode, Inject, Logger, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { EnoughAccountsService } from './enough-accounts.service';
import { BACHS_CONNECT_ACCOUNT_PORT, BachsConnectAccountPort } from './enough.interface';

interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

/**
 * PLAN.md "Paga integration" — Paga's funding notification for a
 * Subsidiary Account (see PagaConnectAccountProvider's doc comment on
 * why this class moved onto that product). A separate route from
 * /webhooks/bachs-connect and /webhooks/nomba (same reasoning as Nomba
 * getting its own controller instead of reusing Bachs': the payload
 * shapes aren't related). Subsidiary Accounts without their own
 * callbackUrl fall back to the business-wide global callback set in
 * the Paga dashboard under Developer Tools — that's the URL to point
 * at this route; nothing in this codebase sets a per-account
 * callbackUrl (see PagaConnectAccountProvider.createAccount).
 *
 * Confirmed payload shape (Subsidiary Accounts page, pasted
 * 2026-11-20): statusCode, statusMessage, transactionReference,
 * fundingTransactionReference, fundingPaymentReference, accountNumber,
 * accountName, financialIdentificationNumber, amount,
 * clearingFeeAmount, payerDetails, narration, transactionDate — no
 * `hash` field in the body itself; the signature is in the
 * x-paga-hash-v3 header instead, see verifyWebhook. accountNumber is
 * Paga's real issued bank account number — which IS
 * EnoughAccount.bachsAccountId for Paga accounts, see
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
  async handle(@Req() req: RequestWithRawBody, @Headers() headers: Record<string, string>) {
    const { valid, payload } = this.paga.verifyWebhook(req.rawBody ?? Buffer.alloc(0), headers);
    if (!valid) {
      this.logger.warn('Paga funding notification failed signature validation — ignoring');
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
