import { api } from './client';
import { EscrowRecordView, FundGigResult } from './types';

/** Creates (or re-fetches) the manual-pilot transfer instructions for a gig. */
export function fundGig(gigId: string) {
  return api.post<FundGigResult>(`gigs/${gigId}/fund`);
}

/** Poll this while waiting for the founder to confirm the transfer landed. */
export function getEscrow(gigId: string) {
  return api.get<EscrowRecordView>(`gigs/${gigId}/escrow`);
}

/** Professional-only. Claims an open gig and holds its stake in one call. */
export function claimGig(gigId: string) {
  return api.post<EscrowRecordView>(`gigs/${gigId}/claim`);
}

/** Client-only, owner-only. "Approve & release payment" — disburses to the professional. */
export function releaseGig(gigId: string) {
  return api.post<EscrowRecordView>(`gigs/${gigId}/release`);
}
