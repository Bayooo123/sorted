/**
 * HANDOFF.md §3.4 — Payments
 * Owns: all contact with the money rail. Nothing else in the codebase may
 * import the Monnify SDK (or any provider SDK) — everything else calls
 * PaymentsProvider.
 *
 * SEAM: Monnify is an implementation, not the interface. A second provider
 * (redundancy, or a future procurement/government funding flow with
 * entirely different mechanics) is a new class behind this same interface.
 * Escrow (§3.5) calls only this interface, never a provider SDK directly.
 */
import { Kobo } from '../../common/money';

export interface HoldingAccount {
  provider: string;
  holdingAccountRef: string;
  accountNumber: string;
  bankName: string;
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
  createHoldingAccount(gigId: string): Promise<HoldingAccount>;
  confirmFunding(ref: string): Promise<FundingConfirmation>;
  disburse(splits: DisbursementSplit[], idempotencyKey: string): Promise<DisbursementResult>;
  refund(ref: string): Promise<RefundResult>;
  verifyWebhook(payload: unknown, headers: Record<string, string>): Promise<WebhookVerificationResult>;
}

export const PAYMENTS_PROVIDER = 'PAYMENTS_PROVIDER';
