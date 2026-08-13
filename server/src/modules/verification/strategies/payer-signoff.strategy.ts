import { Injectable, NotImplementedException } from '@nestjs/common';
import {
  CriterionForVerification,
  ProofSubmission,
  VerificationOutcome,
  VerificationStrategy,
} from '../verification.interface';

/**
 * v1 VerificationStrategy (HANDOFF.md §3.6): payer taps met/not-met against
 * a photo per locked criterion. Skeleton only — implemented in slice 6
 * (proof upload / solver checklist, mockup 09) and slice 7 (sign-off).
 */
@Injectable()
export class PayerSignoffStrategy implements VerificationStrategy {
  readonly name = 'payer_signoff';

  collectProof(_criterion: CriterionForVerification): Promise<ProofSubmission> {
    throw new NotImplementedException('PayerSignoffStrategy.collectProof — slice 6');
  }

  evaluate(
    _criterion: CriterionForVerification,
    _proof: ProofSubmission,
  ): Promise<VerificationOutcome> {
    throw new NotImplementedException('PayerSignoffStrategy.evaluate — slice 7');
  }
}
