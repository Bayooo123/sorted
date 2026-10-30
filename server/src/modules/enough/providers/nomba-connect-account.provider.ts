import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { BachsConnectAccountPort, CapabilityCheckResult, SubmitIdentityInput, VirtualAccountResult } from '../enough.interface';
import { verifyNombaWebhookSignature } from './nomba-signature.util';

const NOMBA_BASE_URL_DEFAULT = 'https://api.nomba.com';

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

/**
 * PLAN.md "Nomba integration" — replaces Bachs as Enough's deposit-account
 * provider. Confirmed against Nomba's real published docs
 * (developer.nomba.com, pasted into chat 2026-10-27) — unlike the KWIK
 * delivery integration elsewhere in this codebase, every endpoint/field/
 * status value here came from Nomba's own documentation, not a guess.
 * Still never run against Nomba's sandbox from this environment (no
 * network access here) — test end to end in sandbox before relying on
 * this with real money, same caveat as every first-pass provider
 * integration in this codebase.
 *
 * Structurally very different from Bachs: Nomba has ONE primary account
 * for the whole business, not a separate connected sub-account per Enough
 * user — sub-accounts are dashboard-only, not creatable via API (see
 * Nomba's "Managing accounts" guide). A "virtual account" is just an alias
 * that routes deposits straight to that one primary account; it holds no
 * balance of its own. Sorted's own EnoughAccount.availableBalanceKobo is
 * already the real per-user ledger (incremented by the deposit webhook,
 * same as the Bachs path) — none of that money-integrity logic changes,
 * only how the connect/payout calls underneath work.
 *
 * Also structurally different: there is no "capability under manual
 * review" step at all. Virtual account creation is one synchronous call
 * that returns the account number immediately — which is the whole point
 * of switching off Bachs, since that multi-day review queue is exactly
 * what has been blocking Make Payment. checkCapability below always
 * reports 'active': by the time anything calls it, submitRepresentative
 * has already either succeeded or thrown.
 */
@Injectable()
export class NombaConnectAccountProvider implements BachsConnectAccountPort {
  private readonly logger = new Logger(NombaConnectAccountProvider.name);
  private cachedToken: CachedToken | null = null;

  constructor(private readonly config: ConfigService) {}

  private credentials() {
    const baseUrl = (this.config.get<string>('NOMBA_API_BASE_URL') || NOMBA_BASE_URL_DEFAULT).replace(/\/+$/, '');
    const accountId = this.config.get<string>('NOMBA_ACCOUNT_ID');
    const clientId = this.config.get<string>('NOMBA_CLIENT_ID');
    const clientSecret = this.config.get<string>('NOMBA_CLIENT_SECRET');
    if (!accountId || !clientId || !clientSecret) return null;
    return { baseUrl, accountId, clientId, clientSecret };
  }

  /** Cached in-memory for the life of this warm instance — a cold start just re-fetches, same tradeoff as every other in-process cache in this codebase. */
  private async getAccessToken(): Promise<string | null> {
    const creds = this.credentials();
    if (!creds) {
      this.logger.warn('Nomba not configured (missing NOMBA_ACCOUNT_ID/NOMBA_CLIENT_ID/NOMBA_CLIENT_SECRET)');
      return null;
    }
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAt - 30_000 > now) {
      return this.cachedToken.accessToken;
    }
    try {
      const response = await fetch(`${creds.baseUrl}/v1/auth/token/issue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', accountId: creds.accountId },
        body: JSON.stringify({ grant_type: 'client_credentials', client_id: creds.clientId, client_secret: creds.clientSecret }),
      });
      const json = (await response.json()) as { code?: string; data?: { access_token?: string; expiresAt?: string } };
      if (!response.ok || !json.data?.access_token) {
        this.logger.warn(`Nomba auth failed: ${response.status} ${json.code ?? ''}`);
        return null;
      }
      const expiresAt = json.data.expiresAt ? new Date(json.data.expiresAt).getTime() : now + 10 * 60 * 1000;
      this.cachedToken = { accessToken: json.data.access_token, expiresAt };
      return json.data.access_token;
    } catch (err) {
      this.logger.warn(`Nomba auth request failed: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  private async request<T>(method: string, path: string, body?: Record<string, unknown>): Promise<T | null> {
    const creds = this.credentials();
    const token = await this.getAccessToken();
    if (!creds || !token) return null;
    try {
      const response = await fetch(`${creds.baseUrl}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, accountId: creds.accountId },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = (await response.json()) as { code?: string; description?: string; data?: T };
      if (!response.ok) {
        this.logger.warn(`Nomba ${method} ${path} failed: ${response.status} ${json.description ?? ''}`);
        return null;
      }
      return json.data ?? null;
    } catch (err) {
      this.logger.warn(`Nomba ${method} ${path} request failed: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  /**
   * No Nomba call here — there's no "create a sub-account" step with
   * Nomba. Just generates the local reference used both as Nomba's
   * accountRef (set in submitRepresentative, below) and this row's
   * bachsAccountId column — reused as-is rather than migrating it to a
   * generic name, see enough.interface.ts's BachsConnectAccountPort doc
   * comment on why that column is provider-agnostic in practice already.
   */
  async createAccount(_input: { contactEmail: string; displayName: string; firstName: string; lastName: string; bvn: string }): Promise<string> {
    return `nomba_${randomUUID()}`;
  }

  /**
   * THE real Nomba call — one request creates the virtual account AND
   * records the BVN, synchronously. Nomba caps virtual accounts at 2 per
   * accountRef; this is always the first/only one for a given Enough
   * account, so that cap is never hit here.
   */
  async submitRepresentative(accountId: string, input: SubmitIdentityInput): Promise<void> {
    const displayName = `${input.firstName} ${input.lastName}`;
    const result = await this.request<{ bankAccountNumber?: string }>('POST', '/v1/accounts/virtual', {
      accountRef: accountId,
      accountName: displayName,
      currency: 'NGN',
      bvn: input.bvn,
    });
    if (!result?.bankAccountNumber) {
      throw new Error('Nomba virtual account creation failed or Nomba is not configured — see server logs');
    }
  }

  /** No separate capability to poll — see this class's doc comment. */
  async checkCapability(): Promise<CapabilityCheckResult> {
    return { status: 'active', detail: null };
  }

  async ensureVirtualAccount(accountId: string): Promise<VirtualAccountResult | null> {
    const result = await this.request<{ bankAccountNumber?: string; bankName?: string }>(
      'GET',
      `/v1/accounts/virtual/${encodeURIComponent(accountId)}`,
    );
    if (!result?.bankAccountNumber) return null;
    return { id: accountId, accountNumber: result.bankAccountNumber, bankName: result.bankName ?? 'Nomba', bankCode: null };
  }

  /** No-op — no separate transfers capability to request; the primary account can send from day one, see this class's doc comment. */
  async requestTransfersCapability(): Promise<void> {
    return;
  }

  verifyWebhook(rawBody: Buffer, headers: Record<string, string>): { valid: boolean; payload: unknown } {
    return verifyNombaWebhookSignature(rawBody, headers, this.config.get<string>('NOMBA_WEBHOOK_SECRET'));
  }
}
