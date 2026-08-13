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
  /** Populated when roles includes 'solver'. Submarket IDs — see CompleteRoleProfileInput. */
  serviceOfferingSubmarketIds: string[];
  /** Populated when roles includes 'payer'. Submarket IDs — see CompleteRoleProfileInput. */
  seekingCategorySubmarketIds: string[];
}

export interface PayoutDestination {
  bankCode: string;
  accountNumber: string;
  accountName: string;
}

/**
 * Registration: account type (agreed after HANDOFF.md — not in the original
 * doc; see PLAN.md "Registration: account type" for the full writeup).
 *
 * Every account defaults to hybrid: roles = ['payer', 'solver']. A signup
 * can narrow to just one. Whichever roles end up set, the matching
 * category picks are REQUIRED, hybrid included — there is no "fill in
 * later" path:
 *   - roles includes 'solver'  => serviceOfferingSubmarketIds.length >= 1
 *   - roles includes 'payer'   => seekingCategorySubmarketIds.length >= 1
 *
 * Categories are structured picks from the same Submarket taxonomy Gigs
 * uses (HANDOFF.md §3.2 TAXONOMY seam) — not free text — so "I fix pipes"
 * becomes a Submarket row a solver can be matched against later, not a
 * string nothing else in the system can read.
 */
export interface CompleteRoleProfileInput {
  roles: Role[];
  serviceOfferingSubmarketIds?: string[];
  seekingCategorySubmarketIds?: string[];
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
  /**
   * Registration step 2 (after phone+OTP creates the bare account).
   * Validates the roles/category rule documented on CompleteRoleProfileInput
   * and rejects the call if a required category list is missing or empty —
   * this is the enforcement point for "hybrid still requires both."
   */
  completeRoleProfile(userId: string, input: CompleteRoleProfileInput): Promise<IdentityUser>;
}
