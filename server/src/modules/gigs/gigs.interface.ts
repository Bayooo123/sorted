/**
 * HANDOFF.md §3.2 — Gigs
 * Owns: the gig entity, its lifecycle/status machine, and the locked criteria.
 */
import { Kobo } from '../../common/money';

export type GigStatus =
  | 'draft'
  | 'escrow_pending'
  | 'open'
  | 'claimed'
  | 'in_progress'
  | 'submitted'
  | 'signed_off'
  | 'disputed'
  | 'released'
  | 'refunded'
  | 'cancelled';

/**
 * SEAM (§3.2, INTAKE): a gig must not assume a human payer created it.
 * v1 has exactly one source. Future feeders (signal detection, institutional
 * submissions, sensor triggers) add new GigIntake implementations that
 * produce gigs the rest of the system treats identically — this is the seam
 * that lets the "signal-driven problem market" vision arrive as an addition.
 */
export type GigSource = 'self_posted';

export interface GigIntake {
  readonly source: GigSource;
  createGig(input: CreateGigInput): Promise<GigRecord>;
}

export interface CreateGigInput {
  payerId: string;
  title: string;
  description: string;
  domain: string; // FK to taxonomy seed table — data, not a hardcoded enum
  submarket: string; // FK to taxonomy seed table
  payerType: string; // FK to taxonomy seed table
  locationText: string;
  locationGeo?: { lat: number; lng: number };
  materialsMode: 'bounty_covers' | 'solver_supplies';
  bountyKobo: Kobo;
  criteria: string[];
  /** SEAM (§3.2, RECURRENCE): nullable — v1 always null. */
  templateId?: string;
}

export interface GigRecord {
  id: string;
  payerId: string;
  source: GigSource;
  templateId: string | null;
  status: GigStatus;
  bountyKobo: Kobo;
  matchingStrategy: string;
}

export interface GigListFilter {
  domain?: string;
  submarket?: string;
  payerType?: string;
  status?: GigStatus;
}

/** The only surface other modules may call into Gigs through. */
export interface GigsPort {
  createGig(input: CreateGigInput): Promise<GigRecord>;
  /** Locks Criterion.locked = true; transitions draft -> escrow_pending. */
  publishGig(gigId: string): Promise<GigRecord>;
  getGig(gigId: string): Promise<GigRecord>;
  transitionStatus(gigId: string, to: GigStatus): Promise<GigRecord>;
  listGigs(filter: GigListFilter): Promise<GigRecord[]>;
}
