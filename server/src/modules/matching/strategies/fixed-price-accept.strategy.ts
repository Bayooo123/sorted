import { Injectable, NotImplementedException } from '@nestjs/common';
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

  assignProfessional(_gig: GigForPricing, _claim: ClaimAttempt): Promise<AssignmentResult> {
    throw new NotImplementedException('FixedPriceAcceptStrategy.assignProfessional — slice 6');
  }
}
