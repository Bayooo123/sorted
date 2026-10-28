/**
 * PLAN.md "Enough: Bachs Connect account per signup" — Enough's own account/
 * verification/deposit layer. Does NOT model "purposes" (Rent, Food, etc.)
 * — that's a separate, not-yet-designed feature; this is just "does this
 * user have a working Bachs virtual account, and what's arrived in it."
 */

/** Mirrors Bachs' own capability.status values exactly — see /connect/capabilities. */
export type EnoughCapabilityStatus = 'unrequested' | 'restricted' | 'pending' | 'active' | 'unsupported';

export interface EnoughAccountView {
  status: EnoughCapabilityStatus;
  /** Human-readable reason when not active (Bachs' status_details[].message) — null once active. */
  statusDetail: string | null;
  /** The name senders see in their banking app — null until the account exists. */
  accountName: string | null;
  virtualAccountNumber: string | null;
  bankName: string | null;
  bankCode: string | null;
  /** Running total of confirmed deposits, in kobo — not a full ledger. */
  availableBalanceKobo: string;
  /** Whether a transaction PIN has been set — never the PIN or its hash. */
  hasTransactionPin: boolean;
  /** Free-text "describe yourself" — input to EnoughPlanService.generatePlan. Null until saved. */
  description: string | null;
}

/** One suggested (or applied) purpose + its share of income — see EnoughPlanService. */
export interface PlanPurpose {
  name: string;
  targetPercent: number;
}

/** PLAN.md "Enough: History tab" — a single chronological feed over EnoughDepositEvent + EnoughAllocationEvent. */
export interface HistoryEntry {
  id: string;
  type: 'deposit' | 'allocation' | 'payment';
  amountKobo: string;
  occurredAt: string;
  /** Only set for type 'allocation' — which purpose the money was pushed into. */
  purposeName?: string;
  /** Only set for type 'payment'. */
  paymentStatus?: 'processing' | 'completed' | 'failed';
  recipientAccountName?: string;
}

/** A named bucket money's been pushed into from the landing spot. See EnoughPurposesService. */
export interface PurposeView {
  id: string;
  name: string;
  balanceKobo: string;
  /** Suggested share of income, 1-100, from an applied plan — null for a hand-created purpose. */
  targetPercent: number | null;
  /** Sum of this purpose's not-yet-released tranches — informational only, see EnoughPurposesService's doc comment. */
  lockedKobo: string;
}

/** Splits an allocate() push into N tranches releasing every intervalDays — see EnoughPurposesService.allocate. */
export interface PurposeSchedule {
  tranches: number;
  intervalDays: number;
}

export interface TrancheView {
  id: string;
  amountKobo: string;
  releaseAt: string;
  released: boolean;
  releasedEarly: boolean;
}

export interface SubmitIdentityInput {
  firstName: string;
  lastName: string;
  /** 11-digit Nigerian Bank Verification Number. */
  bvn: string;
}

/**
 * The shape EnoughAccountsService reads back after creating/checking a
 * Bachs connected account's virtual_accounts capability.
 */
export interface CapabilityCheckResult {
  status: EnoughCapabilityStatus;
  detail: string | null;
}

export interface VirtualAccountResult {
  id: string;
  accountNumber: string;
  bankName: string;
  /** Not every bank Bachs issues against returns one (confirmed live — GLOBUS BANK omits it). */
  bankCode: string | null;
}

/**
 * The only surface EnoughAccountsService calls into Bachs through — kept
 * narrow and provider-agnostic the same way PaymentsProvider/
 * PostcodeProviderPort are, even though only one real implementation
 * (Bachs) exists today. NOT the same interface as PaymentsProvider:
 * that's Sorted's escrow/destination-charge concern (recipient-
 * configuration, professional payouts); this is merchant-configuration
 * virtual_accounts for consumer deposits — a different Bachs persona
 * entirely, even though it's the same vendor.
 */
export interface BachsConnectAccountPort {
  /** Creates the connected account with virtual_accounts AND transfers requested. Returns Bachs' acct_... id. */
  createAccount(input: { contactEmail: string; displayName: string }): Promise<string>;
  /** Submits the BVN representative — the actual identity-verification step. */
  submitRepresentative(accountId: string, input: SubmitIdentityInput): Promise<void>;
  /** Reads the virtual_accounts capability's current status straight from Bachs — never cached. */
  checkCapability(accountId: string): Promise<CapabilityCheckResult>;
  /** Idempotent — safe to call repeatedly. Null if the capability isn't active yet (403). */
  ensureVirtualAccount(accountId: string): Promise<VirtualAccountResult | null>;
  /**
   * Backfill for accounts created before transfers was requested at
   * signup (see createAccount) — EnoughPaymentsService calls this when
   * BachsPayoutPort.pullToPlatform reports the capability as unrequested,
   * the same self-heal-on-use pattern as ensureVirtualAccount.
   */
  requestTransfersCapability(accountId: string): Promise<void>;
  verifyWebhook(rawBody: Buffer, headers: Record<string, string>): { valid: boolean; payload: unknown };
}

export const BACHS_CONNECT_ACCOUNT_PORT = 'BACHS_CONNECT_ACCOUNT_PORT';

/**
 * PLAN.md "Enough: Make Payment" — real money leaving the account via
 * Bachs' payouts API. Built from a third-party SDK generated from Bachs'
 * OpenAPI spec (github.com/Daviduche03/bachs-io-sdk-python-4), NOT from
 * Bachs' own published docs — docs.bachs.io/api.bachs.io don't resolve
 * from this environment, unlike every other Bachs integration in this
 * codebase, which was confirmed against real pasted docs first. CONFIRM
 * WITH BACHS BEFORE RELYING ON THIS WITH REAL MONEY, especially the
 * two-step flow and the X-Connected-Account-ID header name — see
 * BachsPayoutProvider's doc comment for the full mechanism.
 */
export interface BankOption {
  code: string;
  name: string;
}

export interface ResolvedAccount {
  accountName: string;
  accountNumber: string;
}

/**
 * Thrown by BachsPayoutPort.pullToPlatform when Bachs reports the
 * connected account's transfers capability as not enabled (403) — a
 * distinct case from a generic failure, since EnoughPaymentsService can
 * self-heal it via BachsConnectAccountPort.requestTransfersCapability
 * rather than just failing the payment outright.
 */
export class TransfersNotEnabledError extends Error {}

export interface BachsPayoutPort {
  listBanks(): Promise<BankOption[]>;
  /** Resolved server-side, never trusted from the client — shown back for confirmation before send. */
  resolveAccount(bankCode: string, accountNumber: string): Promise<ResolvedAccount>;
  /** Step 1: pulls amountKobo from a connected account's own balance up to the platform's balance. Returns Bachs' transfer id. */
  pullToPlatform(connectedAccountId: string, amountKobo: bigint): Promise<string>;
  /** Step 2: pays out from the platform's own balance to the recipient's real bank account. */
  createWithdrawal(input: {
    bankCode: string;
    accountNumber: string;
    accountName: string;
    amountKobo: bigint;
    reference: string;
    email: string;
  }): Promise<{ withdrawalId: string; status: string }>;
  verifyWebhook(rawBody: Buffer, headers: Record<string, string>): { valid: boolean; payload: unknown };
}

export const BACHS_PAYOUT_PORT = 'BACHS_PAYOUT_PORT';

/**
 * PLAN.md "Settlement sweep" — the ONE rail every actual user payout
 * executes through, always, regardless of ENOUGH_PROVIDER_KEY (which only
 * controls which provider NEW accounts/deposits are created under). Fixed
 * to Nomba in enough.module.ts, not switchable — see SettlementSweepService's
 * doc comment for why: deposits collected on a different provider (e.g.
 * Bachs) are physically swept into Nomba's one settlement account by that
 * background job, so Nomba is the only rail that can ever be guaranteed
 * to actually hold the funds a payout needs. BACHS_PAYOUT_PORT stays
 * switchable and is still used — but only by SettlementSweepService, to
 * pull+sweep money OUT of Bachs, never for a user-facing withdrawal.
 */
export const SETTLEMENT_PAYOUT_PORT = 'SETTLEMENT_PAYOUT_PORT';

/** Where a payment draws from — the landing spot, or a specific purpose's unlocked balance. */
export type PaymentSource = { type: 'landing_spot' } | { type: 'purpose'; purposeId: string };

export interface PaymentEventView {
  id: string;
  amountKobo: string;
  status: 'processing' | 'completed' | 'failed';
  failureReason: string | null;
  recipientBankName: string | null;
  recipientBankCode: string;
  recipientAccountNumber: string;
  recipientAccountName: string;
  createdAt: string;
}
