/**
 * HANDOFF.md §3.1 — Identity
 * Owns: users, password-based auth, roles (client/professional), KYC status,
 * payout bank details, monnify_customer_ref.
 *
 * Not in HANDOFF.md: originally phone+OTP (then email-OTP added
 * alongside), replaced by email/phone + password — product decision, see
 * PLAN.md "Password-based auth". Both User.phone and User.email stay
 * nullable at the DB level (see schema.prisma's note on User) but both are
 * required at signup, enforced in SignupDto/IdentityService.
 */

export type Role = 'client' | 'professional';
export type KycStatus = 'unverified' | 'pending' | 'verified' | 'rejected';

/**
 * PLAN.md "Individual vs business accounts" — a professional (service
 * provider, e.g. a dry cleaner) can register the account as a business
 * rather than an individual. 'business' requires the 'professional' role
 * and a populated BusinessProfileInput — enforced in
 * IdentityService.completeRoleProfile, not the schema.
 */
export type AccountType = 'individual' | 'business';

export interface BusinessProfileInput {
  companyRegistrationNumber: string;
  /** One or more — CAMA-registered companies can have multiple directors. */
  directorNames: string[];
  businessEmail: string;
  businessPhone: string;
  businessAddress: string;
}

export interface BusinessProfileView extends BusinessProfileInput {
  updatedAt: Date;
}

export interface IdentityUser {
  id: string;
  phone: string | null;
  email: string | null;
  name: string | null;
  /** Public-facing name shown in the professional directory (e.g. a shop name) — falls back to `name` wherever displayed. See PLAN.md "Professional directory". */
  displayName: string | null;
  state: string | null;
  /** Data URI (e.g. "data:image/jpeg;base64,..."), any role. See PLAN.md "Profile photo + KYC apply flow". */
  avatarBase64: string | null;
  roles: Role[];
  kycStatus: KycStatus;
  accountType: AccountType;
  /** Present only when accountType is 'business'. */
  businessProfile: BusinessProfileView | null;
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
  /**
   * Omit to leave the account's current accountType unchanged (an edit to
   * submarket picks shouldn't silently reset business status). Pass
   * 'business' — with businessProfile — either at initial registration or
   * later, on an already-existing account, to convert it: this same
   * endpoint is the conversion path, there is no separate one. Requires
   * roles to include 'professional'; rejected otherwise.
   */
  accountType?: AccountType;
  /** Required when accountType is 'business' (initial or conversion call). Ignored otherwise. */
  businessProfile?: BusinessProfileInput;
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

export interface SignupInput {
  email: string;
  phone: string;
  name: string;
  state: string;
  password: string;
}

/** identifier is an email or a phone number — IdentityService looks up both columns. */
export interface LoginInput {
  identifier: string;
  password: string;
}

export interface AuthResult {
  accessToken: string;
  user: IdentityUser;
}

/**
 * Backfills name/phone/state on accounts created before those were
 * required at signup (every account from the phone/email+OTP era — see
 * PLAN.md "Password-based auth"). All optional; only the fields present
 * are changed. phone is normalized (leading-zero Nigerian local format
 * accepted, not just E.164) before the uniqueness check.
 */
export interface UpdateProfileInput {
  name?: string;
  phone?: string;
  state?: string;
  /** Empty string clears it back to falling through to `name`. See IdentityUser.displayName. */
  displayName?: string;
}

/** identifier is an email or a phone number — same lookup as LoginInput. See PLAN.md "Forgot password". */
export interface ForgotPasswordInput {
  identifier: string;
}

export interface ResetPasswordInput {
  identifier: string;
  code: string;
  newPassword: string;
}

export interface UpdateAvatarInput {
  /** Data URI — png/jpeg/webp, size-capped in IdentityService. */
  avatarBase64: string;
}

/**
 * Manual-pilot professional verification (product decision, not in
 * HANDOFF.md — see PLAN.md "Profile photo + KYC apply flow"). NOT the
 * same "Verification" as HANDOFF.md §3.6 (criterion proof/sign-off,
 * modules/verification/) — this is KYC (User.kycStatus), owned by
 * Identity §3.1. A professional applies with a photo/ID; the founder
 * reviews by hand (AdminGuard) and approves/rejects, same disclosed-
 * manual pattern as escrow funding.
 */
export type KycRequestStatus = 'pending' | 'approved' | 'rejected';

export interface KycRequestView {
  id: string;
  status: KycRequestStatus;
  note: string | null;
  reviewNote: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
}

/** Only returned from the admin listing — includes the document image and applicant contact info the founder needs to actually review it. */
export interface KycRequestAdminView extends KycRequestView {
  userId: string;
  userName: string | null;
  userEmail: string | null;
  userPhone: string | null;
  documentBase64: string;
}

export interface ApplyForKycInput {
  documentBase64: string;
  note?: string;
}

export interface ReviewKycInput {
  decision: 'approved' | 'rejected';
  reviewNote?: string;
}

/**
 * PLAN.md "Professional directory" — a client-facing listing of
 * professionals offering a given category, distinct from Gigs' Browse
 * (which lists open jobs, not people). Deliberately thin: no phone/email
 * (contact happens through the gig-invite flow, not direct off-platform
 * contact — see GigsPort.createGig's restrictedToProfessionalId), no
 * location (category-only filtering for v1, per PLAN.md's writeup).
 */
export interface ProfessionalDirectoryEntry {
  id: string;
  /** displayName if set, else name, else a generic fallback — never null, this is what's rendered. */
  displayName: string;
  avatarBase64: string | null;
  kycStatus: KycStatus;
  accountType: AccountType;
}

/** The only surface other modules may call into Identity through. */
export interface IdentityPort {
  getUser(userId: string): Promise<IdentityUser>;
  verifyIdentity(userId: string, input: unknown): Promise<KycStatus>;
  getPayoutDestination(userId: string): Promise<PayoutDestination | null>;
  /** PLAN.md "Split payment pivot" — null until EscrowService.getOrCreateSubaccount has run for this professional at least once. */
  getPaystackSubaccountCode(userId: string): Promise<string | null>;
  setPaystackSubaccountCode(userId: string, subaccountCode: string): Promise<void>;
  assertRole(userId: string, role: Role): Promise<void>;
  /**
   * Accepts local (0-prefixed) or E.164 form, same normalization as
   * login/forgot-password. Returns null rather than throwing when no
   * account matches — used by WhatsappWebhookModule to decide whether an
   * inbound message is from a registered user, where "not registered" is
   * an expected, common outcome, not an error.
   */
  findUserByPhone(phone: string): Promise<IdentityUser | null>;
  /**
   * Registration step 2 (after phone+OTP creates the bare account).
   * Validates the roles/category rule documented on CompleteRoleProfileInput
   * and rejects the call if a required category list is missing or empty —
   * this is the enforcement point for "hybrid still requires both."
   */
  completeRoleProfile(userId: string, input: CompleteRoleProfileInput): Promise<IdentityUser>;
}

/**
 * signup / login / setPayoutDestination are NOT on IdentityPort — they're
 * triggered by HTTP (IdentityController), not called by other modules.
 * IdentityPort is specifically "what other modules may call"; these live
 * as plain methods on IdentityService instead. Kept here as named types so
 * the controller and service share one definition.
 */
