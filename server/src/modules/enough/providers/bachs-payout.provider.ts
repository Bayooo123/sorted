import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { BachsPayoutPort, BankOption, ResolvedAccount } from '../enough.interface';

const BACHS_SANDBOX_BASE_URL = 'https://sandbox-api.bachs.io';

/**
 * Bachs payout adapter for Enough's "Make Payment" — sends real money OUT
 * to a real bank account. See BachsPayoutPort's doc comment in
 * enough.interface.ts for the full caveat: this was built from a
 * third-party SDK generated from Bachs' OpenAPI spec, not Bachs' own
 * docs (unreachable from this environment) — CONFIRM WITH BACHS BEFORE
 * RELYING ON THIS WITH REAL MONEY.
 *
 * Two-step mechanism, per that SDK: a connected account's balance can't
 * be paid out directly to an external bank account.
 *   Step 1 (pullToPlatform): POST /v1/transfers with
 *     destination: "self", acting AS the connected account via an
 *     X-Connected-Account-ID header — pulls that balance UP to the
 *     platform's own balance. (Header name taken from the SDK's own
 *     doc text; BachsConnectAccountProvider's working endpoints use
 *     X-Account-Id instead — these may or may not be the same header
 *     under two names, unconfirmed.)
 *   Step 2 (createWithdrawal): the platform-level /v1/payouts/*
 *     endpoints (NOT connected-account scoped) pay OUT from the
 *     platform's own balance to the recipient's real bank account.
 *     Same platform credential as BachsConnectAccountProvider
 *     (BACHS_SECRET_KEY) — Bachs' payouts aren't a separate persona,
 *     just a separate capability on the same platform account.
 *
 * Amounts here are decimal NAIRA STRINGS (e.g. "7000.00"), unlike the
 * deposits side of this integration which works in kobo — koboToNaira
 * below is the only place this module converts between the two.
 */
@Injectable()
export class BachsPayoutProvider implements BachsPayoutPort {
  private readonly logger = new Logger(BachsPayoutProvider.name);

  constructor(private readonly config: ConfigService) {}

  private secretKey(): string {
    const key = this.config.get<string>('BACHS_SECRET_KEY');
    if (!key) throw new Error('BACHS_SECRET_KEY is not set — see server/.env.example');
    return key;
  }

  private baseUrl(): string {
    return this.config.get<string>('BACHS_API_BASE_URL') ?? BACHS_SANDBOX_BASE_URL;
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<{ ok: boolean; status: number; data: unknown }> {
    const response = await fetch(`${this.baseUrl()}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.secretKey()}`, 'Content-Type': 'application/json', ...extraHeaders },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, data };
  }

  private koboToNaira(kobo: bigint): string {
    const whole = kobo / BigInt(100);
    const frac = (kobo % BigInt(100)).toString().padStart(2, '0');
    return `${whole}.${frac}`;
  }

  async listBanks(): Promise<BankOption[]> {
    const { ok, status, data } = await this.request('GET', '/v1/payouts/banks');
    if (!ok) throw new Error(`Bachs GET /v1/payouts/banks failed: ${status} ${JSON.stringify(data)}`);
    const rows = ((data as { data?: Record<string, unknown>[] })?.data ?? []) as Record<string, unknown>[];
    return rows
      .map((r) => ({ code: String(r.code ?? r.bank_code ?? ''), name: String(r.name ?? r.bank_name ?? '') }))
      .filter((b) => b.code && b.name);
  }

  async resolveAccount(bankCode: string, accountNumber: string): Promise<ResolvedAccount> {
    const { ok, status, data } = await this.request('POST', '/v1/payouts/resolve-account', {
      bank_code: bankCode,
      account_number: accountNumber,
    });
    const body = data as { status?: boolean; data?: { account_name?: string }; error?: string };
    if (!ok || !body?.status || !body.data?.account_name) {
      throw new Error(body?.error ?? `Could not resolve that account (status ${status}).`);
    }
    return { accountName: body.data.account_name, accountNumber };
  }

  async pullToPlatform(connectedAccountId: string, amountKobo: bigint): Promise<string> {
    const { ok, status, data } = await this.request(
      'POST',
      '/v1/transfers',
      { destination: 'self', amount: this.koboToNaira(amountKobo), currency: 'NGN' },
      { 'X-Connected-Account-ID': connectedAccountId },
    );
    const body = data as { id?: string };
    if (!ok || !body?.id) {
      throw new Error(`Bachs self-transfer failed for ${connectedAccountId}: ${status} ${JSON.stringify(data)}`);
    }
    return body.id;
  }

  async createWithdrawal(input: {
    bankCode: string;
    accountNumber: string;
    accountName: string;
    amountKobo: bigint;
    reference: string;
    email: string;
  }): Promise<{ withdrawalId: string; status: string }> {
    const { ok, status, data } = await this.request('POST', '/v1/payouts/withdrawals', {
      from_currency: 'NGN',
      to_currency: 'NGN',
      amount: this.koboToNaira(input.amountKobo),
      payment_method: 'BANK_TRANSFER',
      reference: input.reference,
      email: input.email,
      account_number: input.accountNumber,
      bank_code: input.bankCode,
      description: `Enough payment to ${input.accountName}`,
    });
    const body = data as { withdrawal_id?: string; status?: string };
    if (!ok || !body?.withdrawal_id) {
      throw new Error(`Bachs withdrawal failed: ${status} ${JSON.stringify(data)}`);
    }
    return { withdrawalId: body.withdrawal_id, status: body.status ?? 'processing' };
  }

  /**
   * Same HMAC-SHA256 scheme as every other Bachs webhook in this
   * codebase, reading its OWN secret since this is a THIRD separate
   * webhook registration (alongside /webhooks/bachs and
   * /webhooks/bachs-connect) — payout.paid/payout.failed are
   * platform-level events, not Connect events, so they need their own
   * endpoint rather than piggybacking on either existing one.
   */
  verifyWebhook(rawBody: Buffer, headers: Record<string, string>): { valid: boolean; payload: unknown } {
    const secret = this.config.get<string>('BACHS_PAYOUTS_WEBHOOK_SECRET');
    if (!secret || !rawBody || rawBody.length === 0) return { valid: false, payload: null };

    const v2Header = headers['x-bachs-signature-v2'];
    let valid = false;
    if (v2Header) {
      const timestamp = Object.fromEntries(
        v2Header.split(',').map((kv) => {
          const [k, v] = kv.split('=');
          return [k?.trim(), v?.trim()];
        }),
      ).t;
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
    if (!valid) return { valid: false, payload: null };
    return { valid: true, payload: JSON.parse(rawBody.toString('utf8')) };
  }
}
