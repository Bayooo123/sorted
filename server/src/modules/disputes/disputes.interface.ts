/**
 * HANDOFF.md §3.7 — Disputes
 * Owns: the neutral-arbitration flow; freezing money; recording rulings and
 * penalties.
 *
 * SEAM: v1 can be thin — even admin-assisted neutral assignment — BUT the
 * freeze must be real: while a dispute is open, Escrow state = dispute_hold
 * and release is impossible (enforced in Escrow, not here). The interface
 * is built so a full neutral-panel + internal appeal tier slots in later
 * without changing how money freezes.
 */
import { Kobo } from '../../common/money';

export type DisputeRuling = 'for_solver' | 'for_payer' | 'split';
export type DisputeStatus = 'open' | 'assigned' | 'ruled' | 'closed';

export interface DisputeRecord {
  id: string;
  gigId: string;
  raisedBy: string;
  reason: string;
  neutralId: string | null;
  ruling: DisputeRuling | null;
  penaltyKobo: Kobo | null;
  status: DisputeStatus;
}

/** The only surface other modules may call into Disputes through. */
export interface DisputesPort {
  /** Also calls EscrowPort.freezeForDispute(). */
  raiseDispute(gigId: string, raisedBy: string, reason: string): Promise<DisputeRecord>;
  assignNeutral(disputeId: string, neutralId: string): Promise<DisputeRecord>;
  /** Also calls EscrowPort.resolveFrozen() with the same ruling. */
  recordRuling(disputeId: string, ruling: DisputeRuling): Promise<DisputeRecord>;
  applyPenalty(disputeId: string, penaltyKobo: Kobo): Promise<DisputeRecord>;
}
