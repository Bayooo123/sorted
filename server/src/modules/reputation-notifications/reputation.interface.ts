/**
 * HANDOFF.md §3.9 — Reputation
 * Owns: the compounding track record (jobs_completed, dispute_rate — the
 * moat metric).
 *
 * SEAM: scoring is a function that can grow richer without schema change.
 */

export interface ReputationView {
  userId: string;
  jobsCompleted: number;
  disputeRate: number;
}

export type OutcomeType = 'completed' | 'disputed_for' | 'disputed_against' | 'cancelled';

export interface ReputationPort {
  getReputation(userId: string): Promise<ReputationView>;
  recordOutcome(userId: string, outcome: OutcomeType): Promise<void>;
}
