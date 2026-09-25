/**
 * HANDOFF.md §3.4 — Payments
 * Owns: all contact with the money rail. Nothing else in the codebase may
 * import a provider's SDK/REST client directly — everything else calls
 * PaymentsProvider.
 *
 * SEAM: the concrete provider is an implementation, not the interface.
 * v1 was going to be Monnify; replaced with Paystack before Monnify
 * onboarding finished (see PLAN.md "Paystack integration" — product
 * decision, not in HANDOFF.md). A second/future provider is a new class
 * behind this same interface. Escrow (§3.5) calls only this interface,
 * never a provider SDK directly.
 */
import { Kobo } from '../../common/money';

export interface HoldingAccount {
  provider: string;
  holdingAccountRef: string;
  /** Account-number-based providers (manual pilot) populate this; checkout-link providers may omit it. */
  accountNumber?: string;
  bankName?: string;
  /** Checkout-link-based providers (Paystack Transaction Initialize) populate this instead of accountNumber/bankName. */
  checkoutUrl?: string;
}

export interface FundingConfirmation {
  ref: string;
  amountKobo: Kobo;
  confirmedAt: Date;
}

export interface DisbursementSplit {
  destinationRef: string; // payout destination / account ref
  amountKobo: Kobo;
  narration: string;
}

export interface DisbursementResult {
  disbursementRef: string;
  idempotencyKey: string;
}

export interface RefundResult {
  refundRef: string;
}

export interface WebhookVerificationResult {
  valid: boolean;
  eventId: string;
  payload: unknown;
}

/** Bank details to wrap in a provider-side payout destination — see PaymentsProvider.createSubaccount. */
export interface SubaccountDestination {
  bankCode: string;
  accountNumber: string;
  accountName: string;
}

export interface Subaccount {
  provider: string;
  subaccountCode: string;
}

/** One destination's exact cut of a chargeWithSplit call — mirrors DisbursementSplit's shape (amountKobo, not a percentage) so the caller does the kobo math, not the provider. */
export interface SplitDestination {
  subaccountCode: string;
  amountKobo: Kobo;
  narration: string;
}

export interface SplitCharge {
  provider: string;
  /** Provider's reference for this charge attempt — same idempotency role as HoldingAccount.holdingAccountRef. */
  chargeRef: string;
  /** Checkout-link providers (Paystack) populate this — the payer must complete payment here. */
  checkoutUrl?: string;
  /** Account-number-based providers (manual pilot) populate this instead. */
  accountNumber?: string;
  bankName?: string;
}

export interface ResolvedAccount {
  accountNumber: string;
  /**
   * The bank's own name on file for this account, per the provider's
   * verification call — null when the active provider can't verify one
   * (manual pilot has no API to check against). A caller should trust
   * this over whatever the account holder typed when it's present, and
   * fall back to the typed name when it's null.
   */
  accountName: string | null;
}

export interface PaymentsProvider {
  readonly name: string;
  /** payerEmail: checkout-link providers (Paystack) require a customer email at session creation; account-number providers ignore it. */
  createHoldingAccount(gigId: string, amountKobo: Kobo, payerEmail: string): Promise<HoldingAccount>;
  confirmFunding(ref: string): Promise<FundingConfirmation>;
  disburse(splits: DisbursementSplit[], idempotencyKey: string): Promise<DisbursementResult>;
  refund(ref: string): Promise<RefundResult>;
  verifyWebhook(payload: unknown, headers: Record<string, string>): Promise<WebhookVerificationResult>;

  /**
   * PLAN.md "Split payment pivot" — a Paystack compliance requirement, not
   * a preference: Paystack rejected activation because
   * createHoldingAccount+disburse above means Sorted's own balance
   * receives and holds a professional's money before paying it out, which
   * is a regulated custody activity in Nigeria without a CBN license or a
   * licensed-partner arrangement. createSubaccount registers a payout
   * destination Paystack can pay DIRECTLY at settlement time instead.
   *
   * Called by EscrowService.getOrCreateSubaccount, lazily, the first time
   * a professional's gig actually reaches release — see escrow.service.ts.
   */
  createSubaccount(dest: SubaccountDestination): Promise<Subaccount>;

  /**
   * Replaces createHoldingAccount + confirmFunding + disburse as ONE call:
   * the payer's charge and every destination's payout happen atomically at
   * the provider's end, so nothing ever sits in Sorted's own balance.
   * amountKobo is the payer's total charge; splits must sum to it (the
   * caller's job to verify — see EscrowService's eventual release
   * rewrite). payerEmail: same checkout-link requirement as
   * createHoldingAccount.
   */
  chargeWithSplit(gigId: string, amountKobo: Kobo, payerEmail: string, splits: SplitDestination[]): Promise<SplitCharge>;

  /**
   * PLAN.md "Account number verification" — confirms a bank code +
   * account number actually resolves to a real account before Sorted
   * trusts it, same idea Paystack's own docs recommend ("confirm a
   * customer's bank details before creating a transfer recipient").
   * Called by IdentityService.setPayoutDestination before a professional's
   * payout details are saved — catches a mistyped account number at the
   * point of entry, not deep inside a release/chargeWithSplit failure.
   * Throws (never returns a fabricated match) when the provider can
   * positively determine the account doesn't exist or the bank code is
   * invalid; returns accountName: null when the provider simply can't
   * verify at all (manual pilot).
   */
  resolveAccount(bankCode: string, accountNumber: string): Promise<ResolvedAccount>;
}

export const PAYMENTS_PROVIDER = 'PAYMENTS_PROVIDER';
