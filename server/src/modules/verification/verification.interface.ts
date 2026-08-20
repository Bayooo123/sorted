/**
 * HANDOFF.md §3.6 — Verification
 * Owns: deciding whether a criterion is "met."
 *
 * SEAM: v1 = ClientSignoff. Known futures (tamper-evident media, third-party
 * inspection, automated per-problem-type checks) are alternate strategies
 * behind this interface. "How done is proven" is isolated here so richer
 * verification never touches Escrow or Gigs. Different gig types can carry
 * different strategies later (Criterion.verification_strategy is per-row).
 */

export interface CriterionForVerification {
  id: string;
  gigId: string;
  text: string;
}

export interface ProofSubmission {
  criterionId: string;
  proofUrl: string;
}

export interface VerificationOutcome {
  criterionId: string;
  met: boolean;
}

export interface VerificationStrategy {
  readonly name: string;
  collectProof(criterion: CriterionForVerification): Promise<ProofSubmission>;
  evaluate(criterion: CriterionForVerification, proof: ProofSubmission): Promise<VerificationOutcome>;
}

export const VERIFICATION_STRATEGY = 'VERIFICATION_STRATEGY';
