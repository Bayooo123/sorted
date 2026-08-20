import { Injectable, NotImplementedException } from '@nestjs/common';
import {
  CriterionForVerification,
  ProofSubmission,
  VerificationOutcome,
  VerificationStrategy,
} from '../verification.interface';

/**
 * v1 VerificationStrategy (HANDOFF.md §3.6): client taps met/not-met against
 * a photo per locked criterion. Skeleton only — implemented in slice 6
 * (proof upload / professional checklist, mockup 09) and slice 7 (sign-off).
 */
@Injectable()
export class ClientSignoffStrategy implements VerificationStrategy {
  readonly name = 'client_signoff';

  collectProof(_criterion: CriterionForVerification): Promise<ProofSubmission> {
    throw new NotImplementedException('ClientSignoffStrategy.collectProof — slice 6');
  }

  evaluate(
    _criterion: CriterionForVerification,
    _proof: ProofSubmission,
  ): Promise<VerificationOutcome> {
    throw new NotImplementedException('ClientSignoffStrategy.evaluate — slice 7');
  }
}
