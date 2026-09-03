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

export interface IdentityUser {
  id: string;
  phone: string | null;
  email: string | null;
  name: string | null;
  state: string | null;
  /** Data URI (e.g. "data:image/jpeg;base64,..."), any role. */
  avatarBase64: string | null;
  roles: Role[];
  kycStatus: KycStatus;
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
