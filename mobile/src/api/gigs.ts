import { api } from './client';
import { CreateGigInput, GigRecord } from './types';

export function createGig(input: CreateGigInput) {
  return api.post<GigRecord>('gigs', input);
}

export function publishGig(gigId: string) {
  return api.post<GigRecord>(`gigs/${gigId}/publish`);
}

export function getGig(gigId: string) {
  return api.get<GigRecord>(`gigs/${gigId}`);
}

/**
 * GigsService.listGigs is still a NotImplementedException stub server-side
 * (PLAN.md, slice 5 — market/browse). There is no "my gigs" endpoint
 * either. Until slice 5 ships, the Home feed (screen 4) and Browse feed
 * (screen 10) cannot read a real list from the server — see
 * HomeFeedScreen's local-session-cache comment for how this app works
 * around that honestly instead of pretending it's wired up.
 */
