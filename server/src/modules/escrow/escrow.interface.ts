/**
 * HANDOFF.md §3.5 + §5 — Escrow ★ (the money core)
 * Owns: the hold-and-release state machine between Payments (the rail) and
 * Gigs (the work). This is Sorted's actual product.
 *
 * State machine (§5): awaiting_funding -> funded -> stake_held -> releasing
 * -> released | refunded, with dispute_hold reachable from stake_held (or
 * later) and blocking every other transition while open.
 *
 * fee is platform_fee_bps CONFIG PER GIG (1000=10%, 500=launch rate), not a
 * constant — see EscrowRecord.platform_fee_bps in prisma/schema.prisma.
 */
import { Kobo } from '../../common/money';

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
  bountyKobo: Kobo;
  stakeKobo: Kobo;
  platformFeeBps: number;
}

/** The only surface other modules may call into Escrow through. */
export interface EscrowPort {
  /** PUBLISH: creates the holding account via PaymentsProvider. */
  fundGig(gigId: string): Promise<EscrowRecordView>;
  /** Read-only lookup — e.g. the mobile app polling FundEscrowScreen for state changes. */
  getEscrow(gigId: string): Promise<EscrowRecordView>;
  /**
   * FUND: marks the holding account funded and transitions Gig to open.
   * In production this is called by a Payments webhook handler after
   * verifyWebhook() passes; during the manual pilot (no Monnify yet) it's
   * called by an admin-gated action once a human confirms the transfer
   * landed — see PLAN.md's "Manual escrow pilot" section. Either way the
   * caller has already established trust; this method just does the
   * state transition + LedgerEntry, provider-agnostically.
   */
  confirmFunding(gigId: string, providerRef: string): Promise<EscrowRecordView>;
  /** CLAIM+STAKE: professional's ~10% stake is held. */
  holdStake(gigId: string, professionalId: string, stakeKobo: Kobo): Promise<EscrowRecordView>;
  /** SIGN-OFF happy path: disburse professional 90% + Sorted fee, return stake. */
  releaseToProfessional(gigId: string): Promise<EscrowRecordView>;
  /** Client-side refund (client bad-faith withholding is a penalty, not this). */
  refundClient(gigId: string): Promise<EscrowRecordView>;
  /** DISPUTE: state = dispute_hold. Release becomes impossible while set. */
  freezeForDispute(gigId: string): Promise<EscrowRecordView>;
  /** Applies a neutral's ruling (for_professional | for_client | split) post-freeze. */
  resolveFrozen(
    gigId: string,
    ruling: 'for_professional' | 'for_client' | 'split',
  ): Promise<EscrowRecordView>;
}
