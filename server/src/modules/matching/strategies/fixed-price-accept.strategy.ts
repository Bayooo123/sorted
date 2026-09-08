import { Injectable } from '@nestjs/common';
import {
  AssignmentResult,
  ClaimAttempt,
  GigForPricing,
  MatchingStrategy,
  PricingResult,
} from '../matching.interface';

/**
 * v1 MatchingStrategy (HANDOFF.md §3.3): client sets the bounty at gig
 * creation; the first credible professional who stakes claims it.
 */
@Injectable()
export class FixedPriceAcceptStrategy implements MatchingStrategy {
  readonly name = 'fixed_price_accept';

  // v1: pass-through — no auction, no dynamic adjustment. The client's
  // number is the price. A different strategy (reverse auction, then
  // signal/dynamic pricing — HANDOFF.md §8) replaces this behind the same
  // call; GigsService never changes.
  priceGig(gig: GigForPricing): Promise<PricingResult> {
    return Promise.resolve({ finalPriceKobo: gig.bountyKobo });
  }

  // v1: first credible professional to claim gets it — no shortlist, no
  // competing offers. EscrowService.holdStake is the only caller and has
  // already checked the gig is still 'open' before this runs, so there's
  // nothing left for this strategy to arbitrate; kept as a real call
  // (not inlined into EscrowService) so a reverse-auction/shortlist
  // strategy can replace just this class later — see matching.interface.ts.
  assignProfessional(gig: GigForPricing, claim: ClaimAttempt): Promise<AssignmentResult> {
    return Promise.resolve({ gigId: gig.id, professionalId: claim.professionalId });
  }
}
