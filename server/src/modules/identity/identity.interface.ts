/**
 * HANDOFF.md §3.1 — Identity
 * Owns: users, phone+OTP auth, roles (client/professional), KYC status, payout bank
 * details, monnify_customer_ref.
 *
 * Not in HANDOFF.md: email-OTP was added as an alternative signup channel
 * (Resend has no SMS/OTP-to-phone product; phone-based SMS OTP via
 * Africa's Talking remains the intended eventual-compulsory identifier,
 * per a later product decision — see PLAN.md). Both User.phone and
 * User.email are nullable; exactly one is required at requestOtp() time.
 */

export type Role = 'client' | 'professional';
export type KycStatus = 'unverified' | 'pending' | 'verified' | 'rejected';

export interface IdentityUser {
  id: string;
  /** Both nullable — exactly one is required at signup, see requestOtp. */
  phone: string | null;
  email: string | null;
  name: string | null;
  roles: Role[];
  kycStatus: KycStatus;
  /** Populated when roles includes 'professional'. Submarket IDs — see CompleteRoleProfileInput. */
  serviceOfferingSubmarketIds: string[];
  /** Populated when roles includes 'client'. Submarket IDs — see CompleteRoleProfileInput. */
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
 * Every account defaults to hybrid: roles = ['client', 'professional']. A signup
 * can narrow to just one. Whichever roles end up set, the matching
 * category picks are REQUIRED, hybrid included — there is no "fill in
 * later" path:
 *   - roles includes 'professional'  => serviceOfferingSubmarketIds.length >= 1
 *   - roles includes 'client'   => seekingCategorySubmarketIds.length >= 1
 *
 * Categories are structured picks from the same Submarket taxonomy Gigs
 * uses (HANDOFF.md §3.2 TAXONOMY seam) — not free text — so "I fix pipes"
 * becomes a Submarket row a professional can be matched against later, not a
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

/**
 * Exactly one of phone/email — enforced in IdentityService.requestOtp
 * (BadRequestException on zero or both), not expressible as a TS union
 * the DTO layer can validate declaratively against class-validator, so
 * both stay optional here and validation lives in the service.
 */
export interface RequestOtpInput {
  phone?: string;
  email?: string;
}

export interface OtpRequestResult {
  requestId: string;
}

export interface OtpVerifyResult {
  accessToken: string;
  user: IdentityUser;
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

/**
 * requestOtp / verifyOtp / setPayoutDestination are NOT on IdentityPort —
 * they're triggered by HTTP (IdentityController), not called by other
 * modules. IdentityPort is specifically "what other modules may call";
 * these live as plain methods on IdentityService instead. Kept here as
 * named types so the controller and service share one definition.
 */
