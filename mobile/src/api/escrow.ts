import { api } from './client';
import { EscrowRecordView } from './types';

/** Poll this while waiting for a release charge/split to confirm — see releaseGig. */
export function getEscrow(gigId: string) {
  return api.get<EscrowRecordView>(`gigs/${gigId}/escrow`);
}

/** Professional-only. Claims an open gig and creates its EscrowRecord in one call. */
export function claimGig(gigId: string) {
  return api.post<EscrowRecordView>(`gigs/${gigId}/claim`);
}

/**
 * Client-only, owner-only. "Approve & pay" — initiates the charge+split
 * (PLAN.md "Split payment pivot") and returns where to pay
 * (releaseCheckout on the response). The gig isn't released yet; poll
 * getEscrow until state === 'released'.
 */
export function releaseGig(gigId: string) {
  return api.post<EscrowRecordView>(`gigs/${gigId}/release`);
}
