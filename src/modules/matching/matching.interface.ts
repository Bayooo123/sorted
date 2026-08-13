/**
 * HANDOFF.md §3.3 — Matching
 * Owns: how a gig gets a price and a solver.
 *
 * SEAM: this is the cleanest, highest-value seam in the system — protect it.
 * Pricing/assignment lives ONLY here, never in the Gig model. Known futures
 * (reverse auction, then signal/dynamic pricing) are alternate
 * MatchingStrategy implementations; swapping one never touches Gigs, Escrow,
 * or the UI contract.
 */
import { Kobo } from '../../common/money';

export interface GigForPricing {
  id: string;
  bountyKobo: Kobo;
  domain: string;
  submarket: string;
}

export interface ClaimAttempt {
  gigId: string;
  solverId: string;
  staked: boolean;
}

export interface PricingResult {
  finalPriceKobo: Kobo;
}

export interface AssignmentResult {
  gigId: string;
  solverId: string;
}

export interface MatchingStrategy {
  readonly name: string;
  priceGig(gig: GigForPricing): Promise<PricingResult>;
  assignSolver(gig: GigForPricing, claim: ClaimAttempt): Promise<AssignmentResult>;
}

export const MATCHING_STRATEGY = 'MATCHING_STRATEGY';
