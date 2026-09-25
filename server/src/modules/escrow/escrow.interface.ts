/**
 * HANDOFF.md §3.5 + §5 — Escrow ★ (the money core)
 * Owns: the claim-and-release state machine between Payments (the rail) and
 * Gigs (the work). This is Sorted's actual product.
 *
 * PLAN.md "Split payment pivot" — this module no longer holds money.
 * Paystack declined activation because the pre-pivot flow (client's full
 * payment lands in Sorted's own Paystack balance via
 * PaymentsProvider.createHoldingAccount, paid out later via disburse) is a
 * CBN-regulated custody activity Sorted isn't licensed for. Nothing is
 * charged anymore until releaseToProfessional — the client's charge and the
 * professional's payout happen atomically via
 * PaymentsProvider.chargeWithSplit, so Sorted's own balance never receives
 * money that isn't its own fee.
 *
 * State machine (repurposed, not renamed, to avoid an enum migration for
 * values that just change meaning): stake_held -> releasing -> released,
 * with dispute_hold reachable from stake_held and blocking release while
 * open. 'awaiting_funding'/'funded' are dead — no EscrowRecord is ever
 * created in either state anymore, see holdStake.
 *
 * THE REAL TRADE-OFF (confirmed with the founder, not an oversight): a
 * professional has no payment guarantee before doing the work under this
 * model. There's no clean technical fix for that on Nigerian payment rails
 * specifically (most payers use bank transfer/USSD, not saved cards, so a
 * pre-authorize-then-capture card mechanic wouldn't cover most
 * transactions anyway) — accepted deliberately, mitigated operationally
 * (e.g. gating by KYC/rating), not papered over with a fake safety net.
 * See resolveFrozen's doc comment for what this means for disputes.
 *
 * fee is platform_fee_bps CONFIG PER GIG (1000=10%, 500=launch rate), not a
 * constant — see EscrowRecord.platform_fee_bps in prisma/schema.prisma.
 *
 * COMMISSION MODEL (PLAN.md "Commission — interim surcharge mechanism"):
 * added on top, not deducted. The client is charged bountyKobo + feeKobo at
 * release time; the professional's split destination gets the FULL
 * bountyKobo, nothing taken out. Sorted's fee has no split destination of
 * its own — it's whatever the charge total minus the professional's share
 * comes to, paid to Sorted's main account by Paystack automatically.
 */
import { Kobo } from '../../common/money';
import { PrismaTx } from '../../common/prisma-tx';

export type EscrowState =
  | 'awaiting_funding' // dead since the split-payment pivot — kept in the enum, never assigned
  | 'funded' // dead, same reason
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
  /** Sorted's commission in kobo, frozen at claim time — see this file's COMMISSION MODEL note. */
  feeKobo: Kobo;
  /** bountyKobo + feeKobo — what the client is actually charged at release. */
  totalChargeKobo: Kobo;
  /** Present once releaseToProfessional has been called — where the client actually pays. Shape depends on the active PaymentsProvider (see payments.interface.ts's SplitCharge). Reuses the EscrowRecord.holdingAccountRef/Details columns from the pre-pivot flow — see that model's schema comment. */
  releaseCheckout?: {
    provider: string;
    accountNumber?: string;
    bankName?: string;
    checkoutUrl?: string;
  };
}

/** The only surface other modules may call into Escrow through. */
export interface EscrowPort {
  /** Read-only lookup — e.g. the client polling for release/payment status. */
  getEscrow(gigId: string): Promise<EscrowRecordView>;
  /**
   * CLAIM: assigns the professional (via MatchingStrategy) and creates the
   * EscrowRecord (state stake_held). No money moves — stakeKobo is
   * computed from DEFAULT_STAKE_BPS config and tracked/displayed only,
   * same as pre-pivot; platformFeeBps is frozen here so a mid-flight
   * config change can't retarget an already-quoted charge.
   */
  holdStake(gigId: string, professionalId: string): Promise<EscrowRecordView>;
  /**
   * THE PAYMENT MOMENT (PLAN.md "Split payment pivot") — the first time
   * any money moves for this gig. Initiates PaymentsProvider.
   * chargeWithSplit, which pays the professional and Sorted's fee
   * atomically once the client actually completes the charge; this only
   * STARTS that and returns where to pay (releaseCheckout) — confirmRelease
   * below is what actually marks the gig released.
   */
  releaseToProfessional(gigId: string): Promise<EscrowRecordView>;
  /**
   * Called by the Paystack webhook once charge.success fires for a
   * releaseToProfessional-initiated charge, or by an admin action during
   * the manual pilot (mirrors how confirmFunding used to work pre-pivot —
   * see PaystackWebhookController / EscrowController's confirm-release
   * route). The only place a gig actually becomes "paid."
   */
  confirmRelease(gigId: string, providerRef: string): Promise<EscrowRecordView>;
  /**
   * DISPUTE: state = dispute_hold. Release becomes impossible while set.
   * tx: DisputesService.raiseDispute passes its own transaction so the
   * freeze, the Dispute row, and the Gig status transition to 'disputed'
   * land atomically — never a freeze with no Dispute row, or vice versa.
   */
  freezeForDispute(gigId: string, tx?: PrismaTx): Promise<EscrowRecordView>;
  /**
   * Applies a ruling post-freeze. Every dispute under this model is
   * pre-payment (raiseDispute only allows claimed/in_progress/submitted —
   * see disputes.service.ts), so there is never money already sitting
   * anywhere to move: for_client closes the gig with no charge ever
   * attempted; for_professional re-attempts the SAME charge+split
   * releaseToProfessional would have done, just entered from dispute_hold.
   * It CANNOT force a charge on an uncooperative client — see
   * EscrowService.resolveFrozen's doc comment for why that's a real limit,
   * not a bug: enforcement in the client's favor is financial (no charge
   * happens without them), enforcement in the professional's favor is
   * reputational only once a client won't cooperate.
   */
  resolveFrozen(gigId: string, ruling: 'for_professional' | 'for_client' | 'split'): Promise<EscrowRecordView>;
}
