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
  type: 'deposit' | 'allocation';
  amountKobo: string;
  occurredAt: string;
  /** Only set for type 'allocation' — which purpose the money was pushed into. */
  purposeName?: string;
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
  /** Creates the connected account with virtual_accounts requested. Returns Bachs' acct_... id. */
  createAccount(input: { contactEmail: string; displayName: string }): Promise<string>;
  /** Submits the BVN representative — the actual identity-verification step. */
  submitRepresentative(accountId: string, input: SubmitIdentityInput): Promise<void>;
  /** Reads the virtual_accounts capability's current status straight from Bachs — never cached. */
  checkCapability(accountId: string): Promise<CapabilityCheckResult>;
  /** Idempotent — safe to call repeatedly. Null if the capability isn't active yet (403). */
  ensureVirtualAccount(accountId: string): Promise<VirtualAccountResult | null>;
  verifyWebhook(rawBody: Buffer, headers: Record<string, string>): { valid: boolean; payload: unknown };
}

export const BACHS_CONNECT_ACCOUNT_PORT = 'BACHS_CONNECT_ACCOUNT_PORT';
