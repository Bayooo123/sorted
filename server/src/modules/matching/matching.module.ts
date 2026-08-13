import { Module } from '@nestjs/common';
import { MATCHING_STRATEGY } from './matching.interface';
import { FixedPriceAcceptStrategy } from './strategies/fixed-price-accept.strategy';

/**
 * Binds the active MatchingStrategy behind the MATCHING_STRATEGY token.
 * Swapping to reverse-auction or signal pricing later (§8) means adding a
 * new strategy class and changing this one provider binding — no other
 * module changes.
 */
@Module({
  providers: [
    FixedPriceAcceptStrategy,
    { provide: MATCHING_STRATEGY, useExisting: FixedPriceAcceptStrategy },
  ],
  exports: [MATCHING_STRATEGY],
})
export class MatchingModule {}
