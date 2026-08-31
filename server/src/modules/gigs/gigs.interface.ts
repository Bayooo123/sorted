/**
 * HANDOFF.md §3.2 — Gigs
 * Owns: the gig entity, its lifecycle/status machine, and the locked criteria.
 */
import { Kobo } from '../../common/money';
import { PrismaTx } from '../../common/prisma-tx';

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
 * SEAM (§3.2, INTAKE): a gig must not assume a human client created it.
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
  clientId: string;
  title: string;
  description: string;
  domain: string; // FK to taxonomy seed table — data, not a hardcoded enum
  submarket: string; // FK to taxonomy seed table
  clientType: string; // FK to taxonomy seed table
  locationText: string;
  locationGeo?: { lat: number; lng: number };
  materialsMode: 'bounty_covers' | 'professional_supplies';
  bountyKobo: Kobo;
  criteria: string[];
  /** SEAM (§3.2, RECURRENCE): nullable — v1 always null. */
  templateId?: string;
}

export interface GigCriterionView {
  text: string;
  locked: boolean;
}

export interface GigRecord {
  id: string;
  clientId: string;
  source: GigSource;
  templateId: string | null;
  title: string;
  description: string;
  domain: string; // taxonomy key
  submarket: string; // taxonomy key
  locationText: string;
  materialsMode: 'bounty_covers' | 'professional_supplies';
  status: GigStatus;
  bountyKobo: Kobo;
  matchingStrategy: string;
  criteria: GigCriterionView[];
  createdAt: Date;
  publishedAt: Date | null;
}

/**
 * clientId scopes to one client's own gigs (any status, including draft —
 * "my gigs"). Without it, listGigs is a public browse: draft is always
 * excluded regardless of `status`, since an unpublished gig's
 * title/description/bounty isn't meant to be visible to anyone but its
 * owner — see GigsService.listGigs's doc comment for the enforcement.
 */
export interface GigListFilter {
  domain?: string;
  submarket?: string;
  clientType?: string;
  status?: GigStatus;
  clientId?: string;
}

/** The only surface other modules may call into Gigs through. */
export interface GigsPort {
  createGig(input: CreateGigInput): Promise<GigRecord>;
  /** Locks Criterion.locked = true; transitions draft -> escrow_pending. */
  publishGig(gigId: string): Promise<GigRecord>;
  getGig(gigId: string): Promise<GigRecord>;
  /** tx: pass the caller's transaction client for an atomic cross-module write — see PrismaTx. */
  transitionStatus(gigId: string, to: GigStatus, tx?: PrismaTx): Promise<GigRecord>;
  listGigs(filter: GigListFilter): Promise<GigRecord[]>;
}
