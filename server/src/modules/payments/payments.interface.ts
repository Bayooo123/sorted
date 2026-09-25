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
   * Not yet called by any service — EscrowService still runs the
   * pre-pivot hold-then-disburse flow above until its own rewrite lands;
   * this and chargeWithSplit exist so that rewrite has a real interface to
   * build against.
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
}

export const PAYMENTS_PROVIDER = 'PAYMENTS_PROVIDER';
