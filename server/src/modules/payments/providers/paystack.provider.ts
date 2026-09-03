import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { Kobo, kobo } from '../../../common/money';
import {
  DisbursementResult,
  DisbursementSplit,
  FundingConfirmation,
  HoldingAccount,
  PaymentsProvider,
  RefundResult,
  WebhookVerificationResult,
} from '../payments.interface';

const PAYSTACK_BASE_URL = 'https://api.paystack.co';

/**
 * v1 real PaymentsProvider (HANDOFF.md §3.4, §5) — replaces the original
 * Monnify plan; see PLAN.md "Paystack integration" for why. This file is
 * the ONLY place in the codebase permitted to talk to Paystack's API —
 * see §9 checklist. First money slice — supervise.
 */
@Injectable()
export class PaystackProvider implements PaymentsProvider {
  readonly name = 'paystack';

  constructor(private readonly config: ConfigService) {}

  private secretKey(): string {
    const key = this.config.get<string>('PAYSTACK_SECRET_KEY');
    if (!key) throw new Error('PAYSTACK_SECRET_KEY is not set — see server/.env.example');
    return key;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.secretKey()}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.status) {
      throw new Error(`Paystack ${method} ${path} failed: ${response.status} ${data?.message ?? ''}`);
    }
    return data.data as T;
  }

  /**
   * Transaction Initialize, not Dedicated Virtual Account — a DVA is a
   * persistent per-CUSTOMER account, which can't disambiguate which gig a
   * transfer was for if one client has more than one gig awaiting funding
   * at once. A one-time checkout session keyed to the gig's own id (as
   * Paystack's `reference`) doesn't have that problem — fundGig already
   * guarantees at most one EscrowRecord per gig — and gives the client
   * card/bank-transfer/USSD choice instead of bank-transfer-only.
   */
  async createHoldingAccount(gigId: string, amountKobo: Kobo, payerEmail: string): Promise<HoldingAccount> {
    const data = await this.call<{ authorization_url: string; reference: string }>(
      'POST',
      '/transaction/initialize',
      {
        email: payerEmail,
        amount: amountKobo, // Paystack amounts are kobo too — no unit conversion
        reference: gigId,
        currency: 'NGN',
        metadata: { gigId },
      },
    );
    return {
      provider: this.name,
      holdingAccountRef: data.reference,
      checkoutUrl: data.authorization_url,
    };
  }

  /**
   * Not called by EscrowService.confirmFunding in the normal path — the
   * webhook controller (escrow/paystack-webhook.controller.ts) verifies
   * the event and calls EscrowService.confirmFunding(gigId, ref) itself.
   * This method exists for a manual re-check (e.g. an admin support tool
   * later) and interface completeness.
   */
  async confirmFunding(ref: string): Promise<FundingConfirmation> {
    const data = await this.call<{ reference: string; amount: number; paid_at: string; status: string }>(
      'GET',
      `/transaction/verify/${encodeURIComponent(ref)}`,
    );
    if (data.status !== 'success') {
      throw new BadRequestException(`Paystack transaction ${ref} is not successful (status: ${data.status})`);
    }
    return { ref: data.reference, amountKobo: kobo(data.amount), confirmedAt: new Date(data.paid_at) };
  }

  /**
   * destinationRef is expected to be a JSON-encoded PayoutDestination
   * ({bankCode, accountNumber, accountName} — identity.interface.ts). No
   * caller exists yet: EscrowService.releaseToProfessional is still a
   * slice-7 stub, so this is forward-built, not yet exercised end-to-end
   * against a real payout.
   */
  async disburse(splits: DisbursementSplit[], idempotencyKey: string): Promise<DisbursementResult> {
    for (const split of splits) {
      const dest = JSON.parse(split.destinationRef) as {
        bankCode: string;
        accountNumber: string;
        accountName: string;
      };
      const recipient = await this.call<{ recipient_code: string }>('POST', '/transferrecipient', {
        type: 'nuban',
        name: dest.accountName,
        account_number: dest.accountNumber,
        bank_code: dest.bankCode,
        currency: 'NGN',
      });
      await this.call('POST', '/transfer', {
        source: 'balance',
        amount: split.amountKobo,
        recipient: recipient.recipient_code,
        reason: split.narration,
        // Per-destination suffix: idempotencyKey alone would collide if a
        // single disburse() call ever pays out more than one destination
        // (e.g. professional payout + Sorted fee in the same batch).
        reference: `${idempotencyKey}:${dest.accountNumber}`,
      });
    }
    return { disbursementRef: idempotencyKey, idempotencyKey };
  }

  /**
   * No caller exists yet (slice 8, disputes). Worth re-confirming against
   * current Paystack docs at integration time — refunds on bank-transfer-
   * funded transactions have historically had more restrictions than
   * card refunds on some API versions, and this can't be verified from
   * this environment.
   */
  async refund(ref: string): Promise<RefundResult> {
    const data = await this.call<{ id: number }>('POST', '/refund', { transaction: ref });
    return { refundRef: String(data.id) };
  }

  /**
   * HMAC-SHA512 of the raw request body, keyed with the secret key —
   * Paystack's documented webhook scheme. `payload` here must be the RAW
   * bytes (Buffer), not a parsed object — HMAC over re-serialized JSON
   * won't match what Paystack signed. See main.ts/api/index.ts's
   * bodyParser `verify` hook, which stashes the raw buffer on
   * req.rawBody for exactly this, and the webhook controller, which
   * passes that buffer straight through as `payload`.
   *
   * IP-allowlisting is deliberately NOT enforced here (only logged as a
   * mismatch warning by the controller, if PAYSTACK_WEBHOOK_IP_ALLOWLIST
   * is set) — Paystack's published webhook source IPs can change and
   * can't be verified from this sandboxed environment, so hard-blocking
   * on a possibly-stale list risks silently dropping real webhooks. The
   * signature check above is the real guarantee.
   */
  async verifyWebhook(payload: unknown, headers: Record<string, string>): Promise<WebhookVerificationResult> {
    const signature = headers['x-paystack-signature'];
    const rawBody = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload ?? ''), 'utf8');
    if (!signature || rawBody.length === 0) {
      return { valid: false, eventId: '', payload: null };
    }

    const expected = crypto.createHmac('sha512', this.secretKey()).update(rawBody).digest('hex');
    if (expected !== signature) {
      return { valid: false, eventId: '', payload: null };
    }

    const parsed = JSON.parse(rawBody.toString('utf8'));
    const eventId = parsed?.data?.reference
      ? `${parsed.event}:${parsed.data.reference}`
      : `${parsed?.event ?? 'unknown'}:${parsed?.data?.id ?? Date.now()}`;
    return { valid: true, eventId, payload: parsed };
  }
}
