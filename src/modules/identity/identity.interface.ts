/**
 * HANDOFF.md §3.1 — Identity
 * Owns: users, phone+OTP auth, roles (payer/solver), KYC status, payout bank
 * details, monnify_customer_ref.
 */

export type Role = 'payer' | 'solver';
export type KycStatus = 'unverified' | 'pending' | 'verified' | 'rejected';

export interface IdentityUser {
  id: string;
  phone: string;
  name: string | null;
  roles: Role[];
  kycStatus: KycStatus;
}

export interface PayoutDestination {
  bankCode: string;
  accountNumber: string;
  accountName: string;
}

/**
 * SEAM (§3.1): KYC is a strategy, not a hardcoded flow. v1 implements one
 * IdentityVerifier (Monnify BVN/NIN). Additional/stricter verification
 * (liveness, document upload) per user tier drops in as another
 * implementation of this interface — Identity's public methods never change.
 */
export interface IdentityVerifier {
  readonly name: string;
  verify(userId: string, input: unknown): Promise<KycStatus>;
}

/** The only surface other modules may call into Identity through. */
export interface IdentityPort {
  getUser(userId: string): Promise<IdentityUser>;
  verifyIdentity(userId: string, input: unknown): Promise<KycStatus>;
  getPayoutDestination(userId: string): Promise<PayoutDestination | null>;
  assertRole(userId: string, role: Role): Promise<void>;
}
