/**
 * HANDOFF.md §3.8 — Ledger ★
 * Owns: the append-only record of every naira movement.
 *
 * SEAM: because it's a complete, immutable audit of positions and outcomes,
 * it's also the foundation the future secondary market stands on —
 * tradeable "verified completed gig" positions become an addition on top of
 * clean ledger + gig-ownership, not a data migration. Build it rigorously.
 */
import { Kobo } from '../../common/money';

export type LedgerEntryType = 'fund' | 'stake' | 'release' | 'refund' | 'fee' | 'penalty' | 'payout';
export type LedgerDirection = 'in' | 'out';

export interface LedgerEntryInput {
  gigId: string;
  type: LedgerEntryType;
  amountKobo: Kobo;
  direction: LedgerDirection;
  providerRef: string;
  /** Unique idempotency key — a replayed webhook must no-op, never double-post. */
  eventId: string;
}

export interface LedgerEntryView extends LedgerEntryInput {
  id: string;
  createdAt: Date;
}

/** The only surface other modules may call into Ledger through. Append-only. */
export interface LedgerPort {
  record(entry: LedgerEntryInput): Promise<LedgerEntryView>;
  getGigLedger(gigId: string): Promise<LedgerEntryView[]>;
  getBalance(gigId: string): Promise<Kobo>;
}

export const LEDGER_PORT = 'LEDGER_PORT';
