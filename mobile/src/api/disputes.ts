import { api } from './client';
import { DisputeRecord } from './types';

/** Either the client or the assigned professional can raise this. Freezes escrow to dispute_hold. */
export function raiseDispute(gigId: string, reason: string) {
  return api.post<DisputeRecord>(`gigs/${gigId}/dispute`, { reason });
}
