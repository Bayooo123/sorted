/**
 * Mirrors server/src/modules/identity/identity.interface.ts and
 * server/src/modules/gigs/gigs.interface.ts exactly (post client/
 * professional rename) — kept as plain types here since the mobile app
 * doesn't share a package with the server (HANDOFF.md's modules are
 * server-internal boundaries; the app is just another client of the
 * published HTTP contract).
 */

export type Role = 'client' | 'professional';
export type KycStatus = 'unverified' | 'pending' | 'verified' | 'rejected';
/** A professional (service provider, e.g. a dry cleaner) can register as a business instead of an individual — 'business' requires the 'professional' role plus a BusinessProfile. */
export type AccountType = 'individual' | 'business';

export interface BusinessProfile {
  companyRegistrationNumber: string;
  directorNames: string[];
  businessEmail: string;
  businessPhone: string;
  businessAddress: string;
  updatedAt: string;
}

export interface IdentityUser {
  id: string;
  phone: string | null;
  email: string | null;
  name: string | null;
  /** Public-facing name shown in the professional directory (e.g. a shop name) — falls back to name wherever displayed. */
  displayName: string | null;
  state: string | null;
  /** Data URI (e.g. "data:image/jpeg;base64,..."), any role. */
  avatarBase64: string | null;
  roles: Role[];
  kycStatus: KycStatus;
  accountType: AccountType;
  /** Present only when accountType is 'business'. */
  businessProfile: BusinessProfile | null;
  serviceOfferingSubmarketIds: string[];
  seekingCategorySubmarketIds: string[];
}

export type KycRequestStatus = 'pending' | 'approved' | 'rejected';

export interface KycRequestView {
  id: string;
  status: KycRequestStatus;
  note: string | null;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

export interface PayoutDestination {
  bankCode: string;
  accountNumber: string;
  accountName: string;
}

export interface AuthResult {
  accessToken: string;
  user: IdentityUser;
}

export interface Domain {
  id: string;
  key: string;
  label: string;
}

export interface Submarket {
  id: string;
  key: string;
  label: string;
  domainId: string | null;
  domain: Domain | null;
}

export interface ClientTypeRef {
  id: string;
  key: string;
  label: string;
}

export type GigStatus =
  | 'draft'
  | 'escrow_pending'
  | 'open'
  | 'claimed'
  | 'in_progress'
  | 'submitted'
  | 'signed_off'
  | 'disputed'
  | 'released'
  | 'refunded'
  | 'cancelled';

export type MaterialsMode = 'bounty_covers' | 'professional_supplies';

export interface CreateGigInput {
  title: string;
  description: string;
  domain: string;
  submarket: string;
  clientType: string;
  locationText: string;
  locationGeo?: { lat: number; lng: number };
  materialsMode: MaterialsMode;
  bountyKobo: number;
  criteria: string[];
  templateId?: string;
  /** Invites this professional directly — set from the directory's "Hire" action. */
  restrictedToProfessionalId?: string;
}

/** PLAN.md "Professional directory" — a client-facing listing of professionals offering a category, distinct from Browse (which lists gigs). */
export interface ProfessionalDirectoryEntry {
  id: string;
  displayName: string;
  avatarBase64: string | null;
  kycStatus: KycStatus;
  accountType: AccountType;
}

export interface GigCriterionView {
  text: string;
  locked: boolean;
}

export interface GigRecord {
  id: string;
  clientId: string;
  source: 'self_posted';
  templateId: string | null;
  title: string;
  description: string;
  domain: string;
  submarket: string;
  locationText: string;
  materialsMode: MaterialsMode;
  status: GigStatus;
  bountyKobo: number;
  matchingStrategy: string;
  criteria: GigCriterionView[];
  createdAt: string;
  publishedAt: string | null;
  /** Set by submitForReview — whole-gig proof (v1 simplification). */
  submissionProofBase64: string | null;
  submissionNote: string | null;
}

export interface GigListFilter {
  domain?: string;
  submarket?: string;
  clientType?: string;
  status?: GigStatus;
}

export type EscrowState =
  | 'awaiting_funding'
  | 'funded'
  | 'stake_held'
  | 'releasing'
  | 'released'
  | 'refunded'
  | 'dispute_hold';

export interface EscrowRecordView {
  gigId: string;
  state: EscrowState;
  bountyKobo: number;
  stakeKobo: number;
  platformFeeBps: number;
  /** Sorted's commission in kobo — added on top of the bounty, not deducted from it (interim mechanism until Nomba virtual accounts land). */
  feeKobo: number;
  /** bountyKobo + feeKobo — what the client actually has to pay into the holding account. */
  totalChargeKobo: number;
  /**
   * Present once fundGig has been called — what the client sees to
   * actually pay. Shape depends on the active PaymentsProvider
   * (server/src/modules/payments/payments.interface.ts's HoldingAccount):
   * manual-pilot populates accountNumber/bankName, Paystack populates
   * checkoutUrl instead.
   */
  holdingAccount?: {
    provider: string;
    accountNumber?: string;
    bankName?: string;
    checkoutUrl?: string;
  };
}

export type FundGigResult = EscrowRecordView;

export type DisputeStatus = 'open' | 'assigned' | 'ruled' | 'closed';
export type DisputeRuling = 'for_professional' | 'for_client' | 'split';

export interface DisputeRecord {
  id: string;
  gigId: string;
  raisedBy: string;
  reason: string;
  neutralId: string | null;
  ruling: DisputeRuling | null;
  penaltyKobo: number | null;
  status: DisputeStatus;
}
