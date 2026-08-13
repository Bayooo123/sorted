import { Injectable, NotImplementedException } from '@nestjs/common';
import {
  AssignmentResult,
  ClaimAttempt,
  GigForPricing,
  MatchingStrategy,
  PricingResult,
} from '../matching.interface';

/**
 * v1 MatchingStrategy (HANDOFF.md §3.3): payer sets the bounty at gig
 * creation; the first credible solver who stakes claims it. Skeleton only —
 * implemented in slice 3 (pricing is a no-op pass-through of bounty_kobo)
 * and slice 6 (claim + stake assignment).
 */
@Injectable()
export class FixedPriceAcceptStrategy implements MatchingStrategy {
  readonly name = 'fixed_price_accept';

  priceGig(_gig: GigForPricing): Promise<PricingResult> {
    throw new NotImplementedException('FixedPriceAcceptStrategy.priceGig — slice 3');
  }

  assignSolver(_gig: GigForPricing, _claim: ClaimAttempt): Promise<AssignmentResult> {
    throw new NotImplementedException('FixedPriceAcceptStrategy.assignSolver — slice 6');
  }
}
