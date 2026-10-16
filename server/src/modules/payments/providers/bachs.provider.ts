import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { Kobo, kobo } from '../../../common/money';
import {
  Bank,
  DisbursementResult,
  DisbursementSplit,
  FundingConfirmation,
  HoldingAccount,
  PaymentsProvider,
  RefundResult,
  ResolvedAccount,
  SplitCharge,
  SplitDestination,
  Subaccount,
  SubaccountDestination,
  WebhookVerificationResult,
} from '../payments.interface';

/**
 * PLAN.md "Bachs payment integration" — second PaymentsProvider behind the
 * same SEAM Paystack already sits behind (see payments.module.ts). Built
 * from Bachs documentation pasted into chat across many rounds, NOT from a
 * live call against Bachs' API from this sandboxed environment (DNS to
 * docs.bachs.io doesn't resolve here either — see PLAN.md) — every request/
 * response shape below is confirmed against real doc pages EXCEPT where a
 * comment says otherwise. Confirm each flagged spot against a real sandbox
 * call before this carries live money.
 *
 * Architecture decisions, confirmed with the founder before writing this
 * (see PLAN.md for the full reasoning):
 *   - Destination charges, not Direct — Sorted is merchant of record,
 *     disputes/refunds hit Sorted's own Bachs balance, matching Sorted's
 *     actual client relationship (same reasoning that got Paystack's
 *     custody objection: see PaymentsProvider.createSubaccount's doc
 *     comment — Bachs' Connect model avoids that same problem a different
 *     way, by letting Sorted name a destination on the charge itself
 *     instead of ever holding the professional's share in Sorted's balance).
 *   - Recipient-only connected accounts (capabilities: transfers + payouts
 *     only, no merchant/payment-acceptance capability) — professionals
 *     never accept a Bachs charge themselves, only receive a transfer.
 *   - Instant payout at settlement (transfer_data on the checkout session
 *     itself, not a delayed separate-transfer call) — confirmed compliant
 *     by the founder directly with Bachs, and accepted as the right
 *     tradeoff for Sorted's flow specifically (the client approves
 *     submitted work BEFORE this charge ever runs, unlike ordinary
 *     e-commerce, which narrows the window Bachs' own "don't transfer
 *     instantly" caution is warning about).
 *
 * Money: Bachs takes/returns decimal NAIRA STRINGS ("9000.00"), never minor
 * units — the opposite convention from this codebase's Kobo integers
 * everywhere else. All conversion happens at this provider's boundary only
 * (nairaString/koboFromNairaString below) — nothing outside this file
 * should ever see a Bachs decimal string.
 */
const BACHS_SANDBOX_BASE_URL = 'https://api.sandbox.bachs.io';

@Injectable()
export class BachsProvider implements PaymentsProvider {
  readonly name = 'bachs';
  constructor(private readonly config: ConfigService) {}

  private secretKey(): string {
    const key = this.config.get<string>('BACHS_SECRET_KEY');
    if (!key) throw new Error('BACHS_SECRET_KEY is not set — see server/.env.example');
    return key;
  }

  private baseUrl(): string {
    return this.config.get<string>('BACHS_API_BASE_URL') ?? BACHS_SANDBOX_BASE_URL;
  }

  private nairaString(amountKobo: Kobo): string {
    return (Number(amountKobo) / 100).toFixed(2);
  }

  private koboFromNairaString(naira: string): Kobo {
    return kobo(Math.round(Number(naira) * 100));
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl()}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.secretKey()}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`Bachs ${method} ${path} failed: ${response.status} ${data?.message ?? data?.error ?? ''}`);
    }
    return data as T;
  }

  /**
   * UNVERIFIED SHAPE: Bachs has no plain "create a charge" endpoint at all
   * — every charge is a checkout session (see PaymentsProvider.
   * chargeWithSplit's doc comment on why that's actually a GOOD fit here,
   * not a workaround). This method exists only for interface completeness;
   * EscrowService never calls it in the live split-payment flow (same as
   * PaystackProvider's own copy of this method — see its doc comment).
   * Reuses the same checkout-sessions call as chargeWithSplit, just
   * without transfer_data.
   */
  async createHoldingAccount(gigId: string, amountKobo: Kobo, payerEmail: string): Promise<HoldingAccount> {
    const data = await this.call<{ id: string; url: string }>('POST', '/v1/checkout-sessions', {
      customer: { email: payerEmail },
      currency: 'NGN',
      amount: this.nairaString(amountKobo),
      reference: gigId,
      metadata: { gigId },
      success_url: 'https://sorted.com.ng/payment-complete',
      cancel_url: 'https://sorted.com.ng/payment-cancelled',
    });
    return { provider: this.name, holdingAccountRef: data.id, checkoutUrl: data.url };
  }

  /**
   * UNVERIFIED PATH: inferred from the llms.txt index's "GET
   * /v1/refunds/by-charge/{payment_id}" convention (payments are keyed by
   * a payment_id) — never fetched a dedicated "retrieve a checkout
   * session/payment" doc page. Not called in the live flow (see
   * createHoldingAccount's doc comment) — confirm the real path before
   * relying on it.
   */
  async confirmFunding(ref: string): Promise<FundingConfirmation> {
    const data = await this.call<{ reference: string; amount: string; paid_at: string; status: string }>(
      'GET',
      `/v1/payments/${encodeURIComponent(ref)}`,
    );
    if (data.status !== 'succeeded') {
      throw new BadRequestException(`Bachs payment ${ref} is not succeeded (status: ${data.status})`);
    }
    return { ref: data.reference, amountKobo: this.koboFromNairaString(data.amount), confirmedAt: new Date(data.paid_at) };
  }

  /**
   * UNVERIFIED SHAPE: the confirmed payout flow (POST
   * /v1/payouts/destinations then POST /v1/payouts) needs a SAVED
   * destination object, not an inline bank account per call the way this
   * interface's DisbursementSplit.destinationRef (a JSON-encoded bank
   * account, mirroring PaystackProvider's own copy of this method) is
   * shaped. Not called in the live flow — chargeWithSplit replaces this
   * entirely for Sorted's actual payout path (see PaymentsProvider.
   * disburse's absence from EscrowService). Written to be interface-
   * complete, not confirmed against a real call.
   */
  async disburse(splits: DisbursementSplit[], idempotencyKey: string): Promise<DisbursementResult> {
    for (const split of splits) {
      const dest = JSON.parse(split.destinationRef) as { bankCode: string; accountNumber: string; accountName: string };
      const destination = await this.call<{ id: string }>('POST', '/v1/payouts/destinations', {
        type: 'bank_account',
        bank_code: dest.bankCode,
        account_number: dest.accountNumber,
        account_name: dest.accountName,
      });
      await this.call('POST', '/v1/payouts', {
        destination: destination.id,
        amount: this.nairaString(split.amountKobo),
        currency: 'NGN',
        reason: split.narration,
        reference: `${idempotencyKey}:${dest.accountNumber}`,
      });
    }
    return { disbursementRef: idempotencyKey, idempotencyKey };
  }

  /**
   * POST /v1/refunds — confirmed path and confirmed behaviour for
   * Destination charges: a refund debits SORTED's own Bachs balance, not
   * the professional's (see this file's top doc comment — this is exactly
   * why Destination over Direct was the right call). payment_id field
   * name inferred from the llms.txt "by-charge/{payment_id}" convention —
   * confirm against a real sandbox call before relying on it.
   */
  async refund(ref: string): Promise<RefundResult> {
    const data = await this.call<{ id: string }>('POST', '/v1/refunds', { payment_id: ref });
    return { refundRef: data.id };
  }

  /** POST /v1/misc/bank-accounts/resolve — confirmed path; field names inferred from the standard resolve-account shape used elsewhere in Bachs' docs. */
  async resolveAccount(bankCode: string, accountNumber: string): Promise<ResolvedAccount> {
    const data = await this.call<{ account_number: string; account_name: string }>('POST', '/v1/misc/bank-accounts/resolve', {
      bank_code: bankCode,
      account_number: accountNumber,
    });
    return { accountNumber: data.account_number, accountName: data.account_name };
  }

  /** GET /v1/reference/banks — confirmed path. */
  async listBanks(): Promise<Bank[]> {
    const data = await this.call<{ data: Array<{ name: string; code: string }> }>('GET', '/v1/reference/banks');
    return data.data.map((b) => ({ name: b.name, code: b.code }));
  }

  /**
   * POST /v1/accounts — confirmed path and confirmed "recipient-only"
   * configuration shape (PLAN.md "Bachs payment integration" — keeps
   * onboarding to just payout capabilities, no merchant/payment-acceptance
   * capability a professional never needs).
   *
   * KNOWN GAP, not fixed here: Bachs' docs describe
   * `requirements.currently_due` fields (persons.*.first_name,
   * persons.*.id_document, etc.) that must be submitted via a separate
   * Persons API call before transfers/payouts capabilities actually
   * activate — SubaccountDestination doesn't carry identity/ID-document
   * data, and nothing here submits it. The account this call creates will
   * likely sit "restricted" until that follow-up exists. Sorted's existing
   * KycRequest flow (photo ID, manual review — see identity module) is the
   * natural source for that data, but wiring it through to Bachs' Persons
   * API is its own follow-up, not done in this pass — flagged, not
   * fabricated.
   *
   * dest.contactEmail is optional on SubaccountDestination (added for this
   * provider — Paystack's copy ignores it); EscrowService.
   * getOrCreateSubaccount passes the professional's own email through.
   * Throws if absent, since Bachs' account-creation payload needs a
   * contact email and there's no sane placeholder to send instead.
   */
  async createSubaccount(dest: SubaccountDestination): Promise<Subaccount> {
    if (!dest.contactEmail) {
      throw new BadRequestException('Bachs account creation requires the professional\'s email — none on file');
    }
    const data = await this.call<{ id: string }>('POST', '/v1/accounts', {
      contact_email: dest.contactEmail,
      configuration: {
        recipient: {
          capabilities: { transfers: { requested: true }, payouts: { requested: true } },
        },
      },
      default_payout_destination: {
        bank_code: dest.bankCode,
        account_number: dest.accountNumber,
        account_name: dest.accountName,
      },
    });
    return { provider: this.name, subaccountCode: data.id };
  }

  /**
   * POST /v1/checkout-sessions with transfer_data — confirmed field names
   * (transfer_data.destination + EXACTLY ONE of platform_fee /
   * transfer_data.amount, per the "Split payments" doc page). Bachs'
   * Destination-charge shape names ONE destination account per charge, not
   * an array — Sorted's own split model only ever has one real destination
   * per charge anyway (the professional; Sorted's cut is whatever's left,
   * same as PaystackProvider's copy of this method), so splits.length > 1
   * is rejected rather than silently dropped.
   *
   * UNVERIFIED: the checkout session's exact response field for the
   * hosted payment URL (assumed `url`, matching the quickstart example)
   * and the id field's exact name (assumed `id`) — never fetched a
   * dedicated "checkout session object reference" doc page. Confirm both
   * against a real sandbox response before relying on them.
   */
  async chargeWithSplit(gigId: string, amountKobo: Kobo, payerEmail: string, splits: SplitDestination[]): Promise<SplitCharge> {
    if (splits.length !== 1) {
      throw new BadRequestException(`BachsProvider.chargeWithSplit supports exactly one split destination per charge, got ${splits.length}`);
    }
    const [destination] = splits;
    const data = await this.call<{ id: string; url: string }>('POST', '/v1/checkout-sessions', {
      customer: { email: payerEmail },
      currency: 'NGN',
      amount: this.nairaString(amountKobo),
      reference: gigId,
      metadata: { gigId },
      transfer_data: {
        destination: destination.subaccountCode,
        amount: this.nairaString(destination.amountKobo),
      },
      success_url: 'https://sorted.com.ng/payment-complete',
      cancel_url: 'https://sorted.com.ng/payment-cancelled',
    });
    return { provider: this.name, chargeRef: data.id, checkoutUrl: data.url };
  }

  /**
   * X-Bachs-Signature-V2 verification — confirmed scheme from the
   * "Setting Up Webhooks" doc page: header shape
   * `t={timestamp},v1={signature}[,v1={signature2}...]` (multiple v1
   * values during a secret-rotation overlap window — any one matching is
   * valid), signature = HMAC-SHA256(webhookSecret, `${timestamp}.${rawBody}`)
   * as hex. Falls back to the legacy X-Bachs-Signature (a plain hex HMAC-
   * SHA256 digest of the raw body alone, no timestamp) if the V2 header is
   * absent, for whichever webhook endpoint Bachs hasn't migrated yet.
   *
   * eventId is the envelope's own `id` (evt_...) — Bachs' docs describe
   * this as the dedup key, same role Paystack's reference:id pair plays
   * for PaystackProvider's copy of this method.
   */
  async verifyWebhook(payload: unknown, headers: Record<string, string>): Promise<WebhookVerificationResult> {
    const secret = this.config.get<string>('BACHS_WEBHOOK_SECRET');
    const rawBody = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload ?? ''), 'utf8');
    if (!secret || rawBody.length === 0) return { valid: false, eventId: '', payload: null };

    const v2Header = headers['x-bachs-signature-v2'];
    let valid = false;
    if (v2Header) {
      const parts = Object.fromEntries(
        v2Header.split(',').map((kv) => {
          const [k, v] = kv.split('=');
          return [k?.trim(), v?.trim()];
        }),
      ) as Record<string, string | undefined> & { t?: string };
      const timestamp = parts.t;
      const signatures = v2Header
        .split(',')
        .filter((kv) => kv.trim().startsWith('v1='))
        .map((kv) => kv.trim().slice(3));
      if (timestamp && signatures.length > 0) {
        const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody.toString('utf8')}`).digest('hex');
        valid = signatures.some((sig) => sig === expected);
      }
    } else {
      const legacy = headers['x-bachs-signature'];
      if (legacy) {
        const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
        valid = legacy === expected;
      }
    }
    if (!valid) return { valid: false, eventId: '', payload: null };

    const parsed = JSON.parse(rawBody.toString('utf8'));
    return { valid: true, eventId: parsed?.id ?? `${parsed?.type ?? 'unknown'}:${Date.now()}`, payload: parsed };
  }
}
