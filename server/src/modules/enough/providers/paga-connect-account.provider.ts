import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BachsConnectAccountPort, CapabilityCheckResult, VirtualAccountResult } from '../enough.interface';
import { pagaHash } from './paga-signature.util';

const PAGA_COLLECT_BASE_URL_DEFAULT = 'https://collect.paga.com';

/**
 * PLAN.md "Paga integration" — a third ENOUGH_PROVIDER_KEY option
 * alongside Bachs and Nomba. Uses Paga's Subsidiary Accounts product
 * (developer-docs.paga.com, pasted into chat 2026-11-20) — NOT the
 * older Persistent Payment Identifier API this class used before
 * (registerPersistentPaymentAccount). That switch is the actual fix
 * for the "401 invalid username or password" error hit testing the old
 * endpoint: Subsidiary Accounts' own docs state it explicitly —
 * "Replacing Persistent Payment Identifiers — Subsidiary Accounts are
 * the recommended way to give customers permanent account numbers in
 * new integrations" — so the old endpoint was very likely deprecated/
 * not provisioned for this account's credentials, not a credentials
 * problem as such.
 *
 * Structurally still like Nomba, not Bachs: one call both creates the
 * account and returns its real, final bank account number — no
 * separate "connected account, then verify identity" step, no
 * capability-under-review wait. createAccount does the real work;
 * submitRepresentative is the no-op. See BachsConnectAccountPort's doc
 * comment on createAccount for why the input type carries firstName/
 * lastName/bvn.
 *
 * Account type: created WITHOUT autoSweep, i.e. "ledger-backed" / holds
 * funds — deliberately, not an oversight. Enough's own purposes feature
 * (splitting a deposit into named buckets, locking tranches, paying out
 * of a specific purpose) only makes sense if the underlying account
 * actually holds a real, standing balance Enough can allocate over
 * time; an auto-sweep account (settles to Paga or to a bank on every
 * inbound payment, keeping no balance) would make that whole model
 * impossible.
 *
 * Why the id returned (and stored as EnoughAccount.bachsAccountId) is
 * still Paga's real accountNumber, not our own accountReference: the
 * funding notification (see PagaWebhookController) gives back
 * `accountNumber`, with no accountReference field in that payload —
 * matching this account's own record requires the same value this
 * class hands back. accountReference (Subsidiary Accounts' own
 * management key — needed for balance/charge/top-up/transfer/retrieve/
 * update/history, none of which this codebase calls yet) is generated
 * fresh in createAccount and NOT persisted anywhere; if a future
 * feature needs those operations, it'll need its own column to recover
 * accountReference for an existing account — flagged here, not
 * silently assumed solved.
 *
 * Base URL: Live https://collect.paga.com, Sandbox
 * https://beta-collect.paga.com — both confirmed directly in Paga's
 * docs this time (the old class's live-host guess is no longer
 * relevant). Override via PAGA_COLLECT_API_BASE_URL.
 *
 * Still never run against Paga's sandbox from this environment (no
 * network access here) — test end to end in sandbox before relying on
 * this with real money.
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
   * reference, generated fresh below and not reused elsewhere (see
   * this class's doc comment on why it isn't persisted); the returned
   * id is Paga's real accountNumber, because that's what the funding
   * notification gives us back to match on.
   *
   * autoSweep is deliberately left out of the request body entirely —
   * that's what makes this a ledger-backed account rather than a
   * pass-through virtual account. "bankPublicId"/"destination"/
   * "accountNumber" (the three autoSweep sub-fields) and callbackUrl
   * all stay out of the hash too, per "use an empty string for any of
   * these you don't send" — see pagaHash's doc comment on why omitting
   * a field from the array has the same effect as sending '' in that
   * position.
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
      accountReference,
      accountName: input.displayName,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.contactEmail,
      iifiNumber: input.bvn || undefined,
      status: 'ACTIVE',
    };
    const hash = pagaHash([referenceNumber, accountReference, input.bvn || undefined], creds.hashKey);

    let response: Response;
    try {
      response = await fetch(`${creds.baseUrl}/subsidiary-accounts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${Buffer.from(`${creds.publicId}:${creds.secretKey}`).toString('base64')}`,
          hash,
        },
        body: JSON.stringify(Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined))),
      });
    } catch (err) {
      throw new Error(`Paga subsidiary-accounts request failed: ${err instanceof Error ? err.message : err}`);
    }
    const json = (await response.json().catch(() => null)) as { statusCode?: string; statusMessage?: string; accountNumber?: string } | null;
    if (!response.ok || json?.statusCode !== '0' || !json.accountNumber) {
      this.logger.warn(`Paga subsidiary-accounts creation failed: ${response.status} ${json?.statusMessage ?? ''}`);
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
   * Subsidiary Accounts' funding notification carries its hash in the
   * x-paga-hash-v3 HEADER (the body itself has no hash field, unlike
   * the old Persistent Payment Identifier callback) and names its own
   * field order in the x-paga-hash-v3-parameters header — so this reads
   * that header rather than hardcoding the field list, which makes it
   * correct even if Paga changes the field set later. Paga's own
   * worked example for this notification gives the formula as
   * transactionReference + transactionDate + amount + accountNumber +
   * timestamp + hashKey — the first four map directly onto fields in
   * the JSON body, but "timestamp" doesn't appear in the pasted payload
   * sample at all (only transactionDate does). Checked here as a
   * fallback against a same-named request header in case Paga sends it
   * that way; if it's actually something else entirely, a field it
   * names that this can't find becomes an empty string (not a guess),
   * which fails the comparison closed rather than passing something
   * unverified — confirm with Paga support before relying on this with
   * real money if verification never succeeds in testing.
   *
   * Field values are pulled from the RAW body text, not the parsed-then-
   * restringified object — re-serializing a parsed JSON number (e.g.
   * 5000.00 -> the JS number 5000 -> the string "5000") would silently
   * change amount's exact text and break the hash; Paga's own docs flag
   * this exact pitfall for the charge/top-up/transfer callback's amount
   * field, and the same risk applies here.
   */
  verifyWebhook(rawBody: Buffer, headers: Record<string, string>): { valid: boolean; payload: unknown } {
    const rawText = rawBody.toString('utf8');
    let payload: unknown;
    try {
      payload = JSON.parse(rawText);
    } catch {
      return { valid: false, payload: null };
    }

    const creds = this.credentials();
    const hash = headers['x-paga-hash-v3'];
    const paramList = headers['x-paga-hash-v3-parameters'];
    if (!creds || !hash || !paramList) {
      this.logger.warn('Paga funding notification missing hash headers, or Paga is not configured — rejecting');
      return { valid: false, payload };
    }

    const fieldNames = paramList.split(',').map((s) => s.trim()).filter(Boolean);
    const values = fieldNames.map((name) => extractRawJsonFieldValue(rawText, name) ?? headers[name.toLowerCase()]);
    const expected = pagaHash(values, creds.hashKey);
    if (expected !== hash) {
      this.logger.warn('Paga funding notification hash did not match — rejecting');
      return { valid: false, payload };
    }
    return { valid: true, payload };
  }
}

/**
 * Pulls a top-level JSON field's value as literal text straight from the
 * raw body, preserving exact numeric formatting (e.g. "5000.00" stays
 * "5000.00" rather than becoming "5000" the way JSON.parse then
 * String(...) would) — see verifyWebhook's doc comment on why that
 * matters for the hash. Only needs to handle this codebase's own
 * webhook payloads: flat, unescaped string/number/null values.
 */
function extractRawJsonFieldValue(rawJson: string, fieldName: string): string | undefined {
  const match = rawJson.match(new RegExp(`"${fieldName}"\\s*:\\s*(?:"([^"]*)"|(-?[0-9.]+)|null)`));
  if (!match) return undefined;
  return match[1] ?? match[2] ?? undefined;
}
