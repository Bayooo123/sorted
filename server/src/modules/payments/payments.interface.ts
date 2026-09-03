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

export interface PaymentsProvider {
  readonly name: string;
  /** payerEmail: checkout-link providers (Paystack) require a customer email at session creation; account-number providers ignore it. */
  createHoldingAccount(gigId: string, amountKobo: Kobo, payerEmail: string): Promise<HoldingAccount>;
  confirmFunding(ref: string): Promise<FundingConfirmation>;
  disburse(splits: DisbursementSplit[], idempotencyKey: string): Promise<DisbursementResult>;
  refund(ref: string): Promise<RefundResult>;
  verifyWebhook(payload: unknown, headers: Record<string, string>): Promise<WebhookVerificationResult>;
}

export const PAYMENTS_PROVIDER = 'PAYMENTS_PROVIDER';
