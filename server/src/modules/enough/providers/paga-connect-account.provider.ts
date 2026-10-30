import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BachsConnectAccountPort, CapabilityCheckResult, VirtualAccountResult } from '../enough.interface';
import { pagaHash } from './paga-signature.util';

const PAGA_COLLECT_BASE_URL_DEFAULT = 'https://collect.paga.com';

/**
 * PLAN.md "Paga integration" — a third ENOUGH_PROVIDER_KEY option
 * alongside Bachs and Nomba. Confirmed against Paga's real published
 * docs (developer-docs.paga.com, pasted into chat 2026-10-30): the
 * Authentication, Hashing, and Persistent Payment Identifier pages.
 *
 * Structurally like Nomba, not Bachs: Paga's persistent payment
 * identifier is ONE call that both creates the account and returns its
 * real, final bank account number — no separate "connected account,
 * then verify identity" step, no capability-under-review wait. Unlike
 * Nomba though, Paga's registerPersistentPaymentAccount needs
 * firstName/lastName (and accepts BVN) up front, so — unlike Nomba,
 * where createAccount is the no-op and submitRepresentative does the
 * real work — HERE createAccount does the real work and
 * submitRepresentative is the no-op. See BachsConnectAccountPort's doc
 * comment on createAccount for why the input type carries those fields.
 *
 * Why the account id IS the bank account number (not a self-chosen
 * reference, unlike Nomba's aliasAccountReference): the deposit
 * callback payload (see PagaWebhookController) gives back
 * `accountNumber` — Paga's issued NUBAN — with NO accountReference
 * field at all. Storing anything else as EnoughAccount.bachsAccountId
 * would leave no way to match an incoming deposit back to the account
 * that owns it. Using the real accountNumber as the id also means
 * ensureVirtualAccount needs no lookup call (and no unconfirmed
 * "Get a Persistent Payment Identifier" endpoint) — the id already IS
 * the answer.
 *
 * Base URL: test host confirmed as beta-collect.paga.com. The live host
 * is inferred by dropping that "beta-" prefix, following the same
 * pattern the Business API docs confirmed (beta.mypaga.com ->
 * www.mypaga.com) — NOT itself confirmed by a pasted doc. Override via
 * PAGA_COLLECT_API_BASE_URL if this guess is wrong; a wrong host fails
 * loudly (connection error) rather than silently.
 *
 * Still never run against Paga's sandbox from this environment (no
 * network access here) — test end to end in sandbox before relying on
 * this with real money, same caveat as every first-pass provider
 * integration in this codebase.
 */
@Injectable()
export class PagaConnectAccountProvider implements BachsConnectAccountPort {
  private readonly logger = new Logger(PagaConnectAccountProvider.name);

  constructor(private readonly config: ConfigService) {}

  private credentials() {
    const baseUrl = (this.config.get<string>('PAGA_COLLECT_API_BASE_URL') || PAGA_COLLECT_BASE_URL_DEFAULT).replace(/\/+$/, '');
    const publicId = this.config.get<string>('PAGA_PUBLIC_ID');
    const secretKey = this.config.get<string>('PAGA_SECRET_KEY');
    const hashKey = this.config.get<string>('PAGA_HASH_KEY');
    if (!publicId || !secretKey || !hashKey) return null;
    return { baseUrl, publicId, secretKey, hashKey };
  }

  /**
   * Real work happens here, not in submitRepresentative — see this
   * class's doc comment. accountReference is OUR organization-chosen
   * reference (11-30 chars per Paga's docs); the returned id is Paga's
   * real accountNumber, not this reference, because that's what the
   * deposit callback gives us back to match on.
   */
  async createAccount(input: { contactEmail: string; displayName: string; firstName: string; lastName: string; bvn: string }): Promise<string> {
    const creds = this.credentials();
    if (!creds) {
      throw new Error('Paga not configured (missing PAGA_PUBLIC_ID/PAGA_SECRET_KEY/PAGA_HASH_KEY)');
    }
    const referenceNumber = `ref_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const accountReference = `enough_${referenceNumber}`.slice(0, 30);
    const body: Record<string, unknown> = {
      referenceNumber,
      phoneNumber: undefined, // no phone on SubmitIdentityInput — email satisfies Paga's "phone OR email" requirement instead
      email: input.contactEmail,
      firstName: input.firstName,
      lastName: input.lastName,
      accountName: input.displayName,
      accountReference,
      financialIdentificationNumber: input.bvn || undefined,
    };
    // hashIndex-1..6 per the Persistent Payment Identifier page's own
    // parameter table (not its prose, and not its JS sample — see
    // paga-signature.util.ts's doc comment): referenceNumber,
    // accountReference, financialIdentificationNumber, creditBankId,
    // creditBankAccountNumber, callbackUrl. We never set
    // creditBankId/creditBankAccountNumber/callbackUrl, so those three
    // are omitted from the hash per "omit any empty/null fields."
    const hash = pagaHash([referenceNumber, accountReference, input.bvn || undefined], creds.hashKey);

    let response: Response;
    try {
      response = await fetch(`${creds.baseUrl}/registerPersistentPaymentAccount`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${Buffer.from(`${creds.publicId}:${creds.secretKey}`).toString('base64')}`,
          hash,
        },
        body: JSON.stringify(Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined))),
      });
    } catch (err) {
      throw new Error(`Paga registerPersistentPaymentAccount request failed: ${err instanceof Error ? err.message : err}`);
    }
    const json = (await response.json().catch(() => null)) as { statusCode?: string; statusMessage?: string; accountNumber?: string } | null;
    if (!response.ok || json?.statusCode !== '0' || !json.accountNumber) {
      this.logger.warn(`Paga registerPersistentPaymentAccount failed: ${response.status} ${json?.statusMessage ?? ''}`);
      throw new Error(json?.statusMessage ? `Paga account creation failed: ${json.statusMessage}` : 'Paga account creation failed or Paga is not configured — see server logs');
    }
    return json.accountNumber;
  }

  /** No-op — real registration already happened in createAccount, see this class's doc comment. */
  async submitRepresentative(): Promise<void> {
    return;
  }

  /** No separate capability to poll — registration is synchronous, same reasoning as Nomba's own checkCapability. */
  async checkCapability(): Promise<CapabilityCheckResult> {
    return { status: 'active', detail: null };
  }

  /** The account id IS the real accountNumber already — see this class's doc comment on why. No lookup call needed or available. */
  async ensureVirtualAccount(accountId: string): Promise<VirtualAccountResult | null> {
    return { id: accountId, accountNumber: accountId, bankName: 'Paga', bankCode: null };
  }

  /** No-op — no separate transfers capability to request; see this class's doc comment. */
  async requestTransfersCapability(): Promise<void> {
    return;
  }

  /**
   * The deposit callback body includes its own `hash` field, but no page
   * pasted into this session states the field order/formula Paga uses
   * to compute it — only the REQUEST-side hash formulas (used in
   * createAccount, above) were confirmed. Fabricating an unconfirmed
   * formula here would either reject every genuine deposit (if wrong)
   * or give false confidence in a check that verifies nothing (if
   * accidentally permissive) — neither is better than being honest about
   * the gap. This checks structural sanity only (a hash field is
   * present) and returns valid, logging loudly every time so the gap
   * stays visible in production logs rather than silently forgotten.
   *
   * DO NOT treat this as a real signature check. Before relying on this
   * with real money: confirm the callback hash formula with Paga support
   * (ask specifically about the Persistent Payment Identifier deposit
   * callback, not the request-side hash — they are different), and/or
   * restrict /webhooks/paga at the network level using Paga's IP
   * Whitelisting feature (developer-docs.paga.com/docs/ip-whitelisting)
   * as the real trust boundary in the meantime.
   */
  verifyWebhook(rawBody: Buffer, _headers: Record<string, string>): { valid: boolean; payload: unknown } {
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return { valid: false, payload: null };
    }
    const hash = (payload as { hash?: unknown })?.hash;
    if (typeof hash !== 'string' || hash.length === 0) {
      return { valid: false, payload };
    }
    this.logger.warn(
      'Paga deposit callback accepted WITHOUT cryptographic signature verification — the callback hash formula is unconfirmed. See PagaConnectAccountProvider.verifyWebhook.',
    );
    return { valid: true, payload };
  }
}
