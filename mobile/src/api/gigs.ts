import { api } from './client';
import { CreateGigInput, GigListFilter, GigRecord } from './types';

export function createGig(input: CreateGigInput) {
  return api.post<GigRecord>('gigs', input);
}

export function publishGig(gigId: string) {
  return api.post<GigRecord>(`gigs/${gigId}/publish`);
}

export function getGig(gigId: string) {
  return api.get<GigRecord>(`gigs/${gigId}`);
}

function toQuery(filter?: GigListFilter): string {
  if (!filter) return '';
  const params = new URLSearchParams();
  if (filter.domain) params.set('domain', filter.domain);
  if (filter.submarket) params.set('submarket', filter.submarket);
  if (filter.clientType) params.set('clientType', filter.clientType);
  if (filter.status) params.set('status', filter.status);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/** Public browse — server always excludes draft gigs here, regardless of `status`. */
export function listGigs(filter?: GigListFilter) {
  return api.get<GigRecord[]>(`gigs${toQuery(filter)}`, false);
}

/** The signed-in user's own gigs, any status (including draft). */
export function listMyGigs(filter?: GigListFilter) {
  return api.get<GigRecord[]>(`gigs/mine${toQuery(filter)}`);
}

/** Professional-only, must hold the active claim. Whole-gig proof + note, transitions in_progress -> submitted. */
export function submitForReview(gigId: string, proofBase64: string, note?: string) {
  return api.post<GigRecord>(`gigs/${gigId}/submit`, { proofBase64, note });
}
