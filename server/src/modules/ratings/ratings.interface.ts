/**
 * Not in HANDOFF.md — see PLAN.md "Simple professional ratings". Owns: a
 * client's 1-5 star rating of the professional on a released gig, and the
 * aggregate summary shown against a professional.
 *
 * Deliberately one-directional (client rates professional, not the
 * reverse) and gig-scoped (one rating per gig, tied to a real completed
 * transaction) — not a general review/reputation system. A customer-side
 * rating and richer signals (on-time rate, dispute history) are a real
 * later decision, not solved here; see this module's "Explicitly
 * deferred" note in PLAN.md.
 */

export interface RatingRecord {
  gigId: string;
  raterId: string;
  rateeId: string;
  stars: number;
  comment: string | null;
  createdAt: Date;
}

export interface ProfessionalRatingSummary {
  average: number | null;
  count: number;
}

/** The only surface other modules may call into Ratings through. */
export interface RatingsPort {
  /**
   * Upsert on purpose (not insert-only) — a client correcting a fat-
   * fingered 5-star-when-they-meant-2 shouldn't need a support ticket.
   * Throws if gigId isn't `released` yet, or raterId isn't that gig's
   * client.
   */
  rateGig(gigId: string, raterId: string, stars: number, comment?: string): Promise<RatingRecord>;
  getProfessionalRatingSummary(professionalId: string): Promise<ProfessionalRatingSummary>;
}
