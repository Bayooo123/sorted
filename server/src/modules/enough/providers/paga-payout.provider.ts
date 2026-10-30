import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BachsPayoutPort, BankOption, ResolvedAccount } from '../enough.interface';
import { pagaHash } from './paga-signature.util';

const PAGA_BUSINESS_BASE_URL_DEFAULT = 'https://www.mypaga.com';
const PAGA_OPERATIONS_PATH = '/paga-webservices/business-rest/secured';

/**
 * PLAN.md "Paga integration" — Paga as a third ENOUGH_PROVIDER_KEY
 * option. Confirmed against Paga's real published docs
 * (developer-docs.paga.com, pasted into chat 2026-10-30): the
 * Authentication, Hashing, and Money Transfer (Payout) pages — the
 * depositToBank operation's URL, headers, hash formula, request/response
 * fields, and getBanks/validateDepositToBank's parameter tables all came
 * from the pasted "9. Deposit To Bank" business-rest-api-operations
 * page, not a guess.
 *
 * getBanks and validateDepositToBank's exact PATHS were not themselves
 * shown in what was pasted — inferred from the one path that WAS given
 * (.../secured/depositToBank) by the same pattern the page states
 * explicitly for that one ("Service Method: depositToBank" -> path ends
 * in /depositToBank). Flagged here, not silently assumed: confirm in
 * sandbox before relying on listBanks/resolveAccount.
 *
 * pullToPlatform is a no-op, same reasoning as Nomba's: a persistent
 * payment identifier's deposits land straight in Sorted's one Paga
 * business-account balance (see PagaConnectAccountProvider's doc
 * comment — no per-user sub-ledger, no creditBankId configured per
 * account), so there's nothing to pull up before a payout can draw on
 * it.
 *
 * resolveAccount uses validateDepositToBank, which — unlike Nomba's pure
 * bank/lookup call — bundles amount+balance-checking into the same
 * request. Since this interface's resolveAccount is only ever used to
 * show the resolved account name back to a user for confirmation before
 * the real amount is sent, it passes a nominal placeholder amount
 * ("1.00") to avoid tripping a same-request balance check that the real
 * send (createWithdrawal, with the real amount) will do properly anyway.
 */
@Injectable()
export class PagaPayoutProvider implements BachsPayoutPort {
  private readonly logger = new Logger(PagaPayoutProvider.name);
  private cachedBanks: { banks: BankOption[]; fetchedAt: number } | null = null;

  constructor(private readonly config: ConfigService) {}

  private credentials() {
    const baseUrl = (this.config.get<string>('PAGA_BUSINESS_API_BASE_URL') || PAGA_BUSINESS_BASE_URL_DEFAULT).replace(/\/+$/, '');
    const publicId = this.config.get<string>('PAGA_PUBLIC_ID');
    const secretKey = this.config.get<string>('PAGA_SECRET_KEY');
    const hashKey = this.config.get<string>('PAGA_HASH_KEY');
    if (!publicId || !secretKey || !hashKey) return null;
    return { baseUrl, publicId, secretKey, hashKey };
  }

  private async request<T>(
    path: string,
    body: Record<string, unknown>,
    hashFields: Array<string | number | null | undefined>,
  ): Promise<{ data: T | null; message: string | null }> {
    const creds = this.credentials();
    if (!creds) {
      this.logger.warn('Paga not configured (missing PAGA_PUBLIC_ID/PAGA_SECRET_KEY/PAGA_HASH_KEY)');
      return { data: null, message: null };
    }
    try {
      const response = await fetch(`${creds.baseUrl}${PAGA_OPERATIONS_PATH}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          principal: creds.publicId,
          credentials: creds.secretKey,
          hash: pagaHash(hashFields, creds.hashKey),
        },
        body: JSON.stringify(body),
      });
      const json = (await response.json().catch(() => null)) as (T & { responseCode?: number; message?: string | null }) | null;
      if (!response.ok || (json?.responseCode !== undefined && json.responseCode !== 0)) {
        this.logger.warn(`Paga POST ${path} failed: ${response.status} ${json?.message ?? ''}`);
        return { data: null, message: json?.message ?? null };
      }
      return { data: json, message: json?.message ?? null };
    } catch (err) {
      this.logger.warn(`Paga POST ${path} request failed: ${err instanceof Error ? err.message : err}`);
      return { data: null, message: null };
    }
  }

  /** Cached for an hour — same tradeoff as NombaPayoutProvider.listBanks; bank UUIDs rarely change. */
  async listBanks(): Promise<BankOption[]> {
    const ONE_HOUR_MS = 60 * 60 * 1000;
    if (this.cachedBanks && Date.now() - this.cachedBanks.fetchedAt < ONE_HOUR_MS) {
      return this.cachedBanks.banks;
    }
    const referenceNumber = `ref_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const { data } = await this.request<{ banks?: { name: string; uuid: string }[] }>(
      '/getBanks',
      { referenceNumber },
      [referenceNumber],
    );
    // BankOption.code carries Paga's bank UUID here (an opaque string as
    // far as this shared interface is concerned) — createWithdrawal's
    // destinationBankUUID needs exactly this value, so no mapping is
    // lost even though the field is generically named "code".
    const banks = (data?.banks ?? []).map((b) => ({ code: b.uuid, name: b.name }));
    if (banks.length > 0) this.cachedBanks = { banks, fetchedAt: Date.now() };
    return banks;
  }

  async resolveAccount(bankCode: string, accountNumber: string): Promise<ResolvedAccount> {
    const referenceNumber = `ref_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const placeholderAmount = '1.00'; // see this class's doc comment — real amount is validated again at send time
    const { data, message } = await this.request<{ destinationAccountHolderNameAtBank?: string }>(
      '/validateDepositToBank',
      { referenceNumber, amount: placeholderAmount, currency: 'NGN', destinationBankUUID: bankCode, destinationBankAccountNumber: accountNumber },
      [referenceNumber, placeholderAmount, bankCode, accountNumber],
    );
    if (!data?.destinationAccountHolderNameAtBank) {
      throw new Error(message ? `Couldn't resolve that account: ${message}` : "Couldn't resolve that account — check the bank and account number.");
    }
    return { accountName: data.destinationAccountHolderNameAtBank, accountNumber };
  }

  /** No-op — see this class's doc comment on why Paga needs no pull-to-platform step. */
  async pullToPlatform(): Promise<string> {
    return 'paga-no-pull-needed';
  }

  async createWithdrawal(input: {
    bankCode: string;
    accountNumber: string;
    accountName: string;
    amountKobo: bigint;
    reference: string;
    email: string;
  }): Promise<{ withdrawalId: string; status: string }> {
    const amount = (Number(input.amountKobo) / 100).toFixed(2);
    const { data, message } = await this.request<{ transactionId?: string }>(
      '/depositToBank',
      {
        referenceNumber: input.reference,
        amount,
        currency: 'NGN',
        destinationBankUUID: input.bankCode,
        destinationBankAccountNumber: input.accountNumber,
        recipientEmail: input.email,
        recipientName: input.accountName,
        remarks: 'Sorted Enough payout',
      },
      [input.reference, amount, input.bankCode, input.accountNumber],
    );
    if (!data?.transactionId) {
      throw new Error(message ? `Paga transfer failed: ${message}` : 'Paga transfer failed or Paga is not configured — see server logs');
    }
    // depositToBank's sample response in Paga's own docs returns a
    // completed-looking message synchronously ("Successfully deposited
    // ... Transaction Id: ..."), unlike Nomba's PENDING_BILLING. Still
    // reported as 'completed' here only for record-keeping — this
    // return value isn't used for control flow by any caller in this
    // codebase (see NombaPayoutProvider.createWithdrawal's own comment
    // on the same point); nothing currently waits on a Paga payout
    // webhook to resolve EnoughPaymentEvent.status for a Paga-routed
    // payment, since SETTLEMENT_PAYOUT_PORT is fixed to Nomba for every
    // real user payout — this provider's createWithdrawal is only ever
    // reached via SettlementSweepService's sweep-to-Nomba step, which
    // resolves success/failure synchronously from this call, not a
    // webhook.
    return { withdrawalId: data.transactionId, status: 'completed' };
  }

  /**
   * The Money Transfer (Payout) page's statusCallbackUrl field links to
   * "the webhook specification" for payout status notifications, but
   * that page's content wasn't pasted into this session — the payload
   * shape and any signature mechanism for IT (as opposed to the
   * registerPersistentPaymentAccount deposit callback, confirmed
   * separately — see PagaConnectAccountProvider.verifyWebhook) are
   * unconfirmed. Fails closed (unlike the deposit-side equivalent) since
   * nothing in this codebase currently depends on this working — see
   * createWithdrawal's doc comment — so there's no functional cost to
   * being conservative here until it's confirmed.
   */
  verifyWebhook(_rawBody: Buffer, _headers: Record<string, string>): { valid: boolean; payload: unknown } {
    this.logger.warn('Paga payout-status webhook received but its payload format is unconfirmed — ignoring. See PagaPayoutProvider.verifyWebhook.');
    return { valid: false, payload: null };
  }
}
