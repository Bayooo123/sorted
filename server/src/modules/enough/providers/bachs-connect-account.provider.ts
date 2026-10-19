import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import {
  BachsConnectAccountPort,
  CapabilityCheckResult,
  EnoughCapabilityStatus,
  SubmitIdentityInput,
  VirtualAccountResult,
} from '../enough.interface';

const BACHS_SANDBOX_BASE_URL = 'https://sandbox-api.bachs.io';

/**
 * Bachs Connect adapter for Enough's own account/BVN/virtual-account flow —
 * confirmed against real Bachs documentation pasted into chat (not a live
 * sandbox call from this environment, same caveat as BachsProvider's own
 * doc comment). Every request/response shape below is taken directly from
 * the docs for: Become a platform, Capabilities, Onboarding, Monitor
 * onboarding, and Virtual accounts — nothing guessed.
 *
 * Deliberately a SEPARATE class from payments/providers/bachs.provider.ts's
 * BachsProvider, even though both call the same vendor: that one is
 * Sorted's recipient-configuration (professional payout) persona; this one
 * is merchant-configuration virtual_accounts for Enough's consumer
 * deposits. Different capability, different account lifecycle, different
 * webhook endpoint/secret — sharing a class would conflate two unrelated
 * Bachs personas behind one name.
 */
@Injectable()
export class BachsConnectAccountProvider implements BachsConnectAccountPort {
  private readonly logger = new Logger(BachsConnectAccountProvider.name);

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
      headers: {
        Authorization: `Bearer ${this.secretKey()}`,
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, data };
  }

  async createAccount(input: { contactEmail: string; displayName: string }): Promise<string> {
    const { ok, status, data } = await this.request('POST', '/v1/accounts', {
      contact_email: input.contactEmail,
      display_name: input.displayName,
      country: 'NG',
      configuration: {
        merchant: { capabilities: { virtual_accounts: { requested: true } } },
      },
    });
    if (!ok) {
      throw new Error(`Bachs POST /v1/accounts failed: ${status} ${JSON.stringify(data)}`);
    }
    const accountId = (data as { id?: string })?.id;
    if (!accountId) throw new Error(`Bachs POST /v1/accounts returned no id: ${JSON.stringify(data)}`);
    return accountId;
  }

  async submitRepresentative(accountId: string, input: SubmitIdentityInput): Promise<void> {
    const { ok, status, data } = await this.request('POST', `/v1/accounts/${accountId}`, {
      fields: {
        persons: [
          {
            first_name: input.firstName,
            last_name: input.lastName,
            id_numbers: [{ type: 'bvn', value: input.bvn, issuing_country: 'NG' }],
            relationship: { representative: true },
          },
        ],
      },
    });
    if (!ok) {
      throw new Error(`Bachs POST /v1/accounts/${accountId} (representative) failed: ${status} ${JSON.stringify(data)}`);
    }
  }

  async checkCapability(accountId: string): Promise<CapabilityCheckResult> {
    const { ok, status, data } = await this.request('GET', `/v1/accounts/${accountId}/capabilities`);
    if (!ok) {
      throw new Error(`Bachs GET /v1/accounts/${accountId}/capabilities failed: ${status} ${JSON.stringify(data)}`);
    }
    const capabilities = (data as { name?: string; status?: string; status_details?: { message?: string }[] }[]) ?? [];
    const entry = Array.isArray(capabilities) ? capabilities.find((c) => c.name === 'virtual_accounts') : undefined;
    if (!entry) return { status: 'unrequested', detail: null };
    return {
      status: (entry.status as EnoughCapabilityStatus) ?? 'unrequested',
      detail: entry.status_details?.[0]?.message ?? null,
    };
  }

  async ensureVirtualAccount(accountId: string): Promise<VirtualAccountResult | null> {
    const { ok, status, data } = await this.request(
      'POST',
      '/v1/virtual-accounts',
      { currency: 'NGN' },
      { 'X-Account-Id': accountId },
    );
    if (status === 403) {
      // Capability not active yet — expected while onboarding is in
      // progress, not an error. See Virtual accounts guide, "API" tab.
      this.logger.log(`Virtual account for ${accountId} not available yet (403) — capability likely not active`);
      return null;
    }
    if (!ok) {
      this.logger.warn(`Bachs POST /v1/virtual-accounts for ${accountId} failed: ${status} ${JSON.stringify(data)}`);
      return null;
    }
    const d = data as { id?: string; account_number?: string; bank_name?: string; bank_code?: string | null };
    if (!d?.id || !d.account_number || !d.bank_name) {
      this.logger.warn(`Bachs POST /v1/virtual-accounts for ${accountId} returned an unexpected shape: ${JSON.stringify(data)}`);
      return null;
    }
    // bank_code is confirmed absent/null on at least one real bank (GLOBUS
    // BANK) in live responses — not every bank Bachs issues against has
    // one, so it's optional here, unlike id/account_number/bank_name which
    // are unconditionally required to actually use the account.
    return { id: d.id, accountNumber: d.account_number, bankName: d.bank_name, bankCode: d.bank_code ?? null };
  }

  /**
   * Same HMAC-SHA256 X-Bachs-Signature-V2 (with legacy X-Bachs-Signature
   * fallback) scheme as BachsProvider.verifyWebhook — Bachs' signing
   * mechanism is uniform across endpoints, only the secret differs because
   * this is a SEPARATE webhook endpoint registration (event_source:
   * "connect"), with its own signing_secret returned once at creation.
   */
  verifyWebhook(rawBody: Buffer, headers: Record<string, string>): { valid: boolean; payload: unknown } {
    const secret = this.config.get<string>('BACHS_CONNECT_WEBHOOK_SECRET');
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
