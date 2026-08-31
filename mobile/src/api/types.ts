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
  roles: Role[];
  kycStatus: KycStatus;
  serviceOfferingSubmarketIds: string[];
  seekingCategorySubmarketIds: string[];
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
}

/**
 * Only present on the response from POST /gigs/:id/fund — the manual-pilot
 * transfer target to show the client (server/src/modules/payments/
 * providers/manual-pilot.provider.ts). Swaps to real Monnify virtual-
 * account instructions later with no shape change the app needs to know
 * about beyond this same field.
 */
export interface FundGigResult extends EscrowRecordView {
  transferInstructions: {
    accountNumber: string;
    bankName: string;
    provider: string;
  };
}
