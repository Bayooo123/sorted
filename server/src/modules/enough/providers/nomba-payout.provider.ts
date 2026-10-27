import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BachsPayoutPort, BankOption, ResolvedAccount } from '../enough.interface';
import { verifyNombaWebhookSignature } from './nomba-signature.util';

const NOMBA_BASE_URL_DEFAULT = 'https://api.nomba.com';

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

/**
 * PLAN.md "Nomba integration" — replaces Bachs for Enough's Make Payment
 * (real money out). Confirmed against Nomba's real published docs
 * (developer.nomba.com, pasted into chat 2026-10-27). Still never run
 * against Nomba's sandbox from this environment — test end to end in
 * sandbox before relying on this with real money.
 *
 * pullToPlatform is a NO-OP here, deliberately: Bachs needed it because a
 * connected account's deposits sit in ITS OWN sub-ledger until pulled up
 * to the platform's balance before a payout can draw on it. Nomba has no
 * such per-user sub-ledger at all — every virtual account's deposits
 * already route straight into Sorted's one primary Nomba account the
 * moment they land (see NombaConnectAccountProvider's doc comment) — so
 * there is nothing to pull. EnoughPaymentsService.initiatePayment still
 * calls both this.bachs.pullToPlatform and this.bachs.createWithdrawal
 * unconditionally (kept that way rather than special-cased per provider,
 * same as the delivery/matching ports elsewhere in this codebase), so
 * this returns a synthetic id immediately with zero network calls —
 * harmless, since the returned id is only ever stored for record-keeping,
 * never used for control flow (see EnoughPaymentsService.initiatePayment).
 */
@Injectable()
export class NombaPayoutProvider implements BachsPayoutPort {
  private readonly logger = new Logger(NombaPayoutProvider.name);
  private cachedToken: CachedToken | null = null;
  private cachedBanks: { banks: BankOption[]; fetchedAt: number } | null = null;

  constructor(private readonly config: ConfigService) {}

  private credentials() {
    const baseUrl = (this.config.get<string>('NOMBA_API_BASE_URL') || NOMBA_BASE_URL_DEFAULT).replace(/\/+$/, '');
    const accountId = this.config.get<string>('NOMBA_ACCOUNT_ID');
    const clientId = this.config.get<string>('NOMBA_CLIENT_ID');
    const clientSecret = this.config.get<string>('NOMBA_CLIENT_SECRET');
    if (!accountId || !clientId || !clientSecret) return null;
    return { baseUrl, accountId, clientId, clientSecret };
  }

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

  private async request<T>(method: string, path: string, body?: Record<string, unknown>): Promise<{ data: T | null; description: string | null }> {
    const creds = this.credentials();
    const token = await this.getAccessToken();
    if (!creds || !token) return { data: null, description: null };
    try {
      const response = await fetch(`${creds.baseUrl}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, accountId: creds.accountId },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = (await response.json()) as { code?: string; description?: string; data?: T };
      if (!response.ok && response.status !== 201) {
        this.logger.warn(`Nomba ${method} ${path} failed: ${response.status} ${json.description ?? ''}`);
        return { data: null, description: json.description ?? null };
      }
      return { data: json.data ?? null, description: json.description ?? null };
    } catch (err) {
      this.logger.warn(`Nomba ${method} ${path} request failed: ${err instanceof Error ? err.message : err}`);
      return { data: null, description: null };
    }
  }

  /** Cached for an hour — Nomba's own docs say bank codes rarely change and recommend caching this response. */
  async listBanks(): Promise<BankOption[]> {
    const ONE_HOUR_MS = 60 * 60 * 1000;
    if (this.cachedBanks && Date.now() - this.cachedBanks.fetchedAt < ONE_HOUR_MS) {
      return this.cachedBanks.banks;
    }
    const { data } = await this.request<{ code: string; name: string }[]>('GET', '/v1/transfers/banks');
    const banks = (data ?? []).map((b) => ({ code: b.code, name: b.name }));
    if (banks.length > 0) this.cachedBanks = { banks, fetchedAt: Date.now() };
    return banks;
  }

  async resolveAccount(bankCode: string, accountNumber: string): Promise<ResolvedAccount> {
    const { data } = await this.request<{ accountNumber: string; accountName: string }>('POST', '/v1/transfers/bank/lookup', {
      accountNumber,
      bankCode,
    });
    if (!data?.accountName) {
      throw new Error("Couldn't resolve that account — check the bank and account number.");
    }
    return { accountName: data.accountName, accountNumber: data.accountNumber };
  }

  /** No-op — see this class's doc comment on why Nomba needs no pull-to-platform step. */
  async pullToPlatform(): Promise<string> {
    return 'nomba-no-pull-needed';
  }

  async createWithdrawal(input: {
    bankCode: string;
    accountNumber: string;
    accountName: string;
    amountKobo: bigint;
    reference: string;
    email: string;
  }): Promise<{ withdrawalId: string; status: string }> {
    const { data, description } = await this.request<{ id: string; status: string }>('POST', '/v2/transfers/bank', {
      amount: Number(input.amountKobo) / 100,
      accountNumber: input.accountNumber,
      accountName: input.accountName,
      bankCode: input.bankCode,
      merchantTxRef: input.reference,
      narration: 'Sorted Enough payout',
    });
    if (!data?.id) {
      throw new Error(description ? `Nomba transfer failed: ${description}` : 'Nomba transfer failed or Nomba is not configured — see server logs');
    }
    // SUCCESS or PENDING_BILLING — either way the webhook (payout_success/
    // payout_failed) is what actually resolves EnoughPaymentEvent.status;
    // see EnoughPaymentsService.handlePayoutWebhook. This return value is
    // stored for record-keeping only.
    return { withdrawalId: data.id, status: data.status ?? 'PENDING_BILLING' };
  }

  verifyWebhook(rawBody: Buffer, headers: Record<string, string>): { valid: boolean; payload: unknown } {
    return verifyNombaWebhookSignature(rawBody, headers, this.config.get<string>('NOMBA_WEBHOOK_SECRET'));
  }
}
