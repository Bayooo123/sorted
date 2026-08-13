import { Inject, Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PAYMENTS_PROVIDER, PaymentsProvider } from '../payments/payments.interface';
import { LEDGER_PORT, LedgerPort } from '../ledger/ledger.interface';
import { Kobo } from '../../common/money';
import { EscrowPort, EscrowRecordView, EscrowState } from './escrow.interface';

/**
 * Skeleton only — implemented across slice 4 (PUBLISH -> FUND) and slice 7
 * (SIGN-OFF -> release), per HANDOFF.md §7. Both are money slices: "First
 * money slice — supervise" / "Supervise."
 *
 * Non-negotiables for the real implementation (HANDOFF.md §9):
 *   - every transition below writes a LedgerEntry via LedgerPort.record()
 *     inside the SAME DB transaction as the state change;
 *   - every transition is idempotent on the provider's event_id;
 *   - no transition out of dispute_hold except through resolveFrozen();
 *   - this service calls PaymentsProvider only through the injected
 *     interface — never a concrete provider class.
 */
@Injectable()
export class EscrowService implements EscrowPort {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENTS_PROVIDER) private readonly payments: PaymentsProvider,
    @Inject(LEDGER_PORT) private readonly ledger: LedgerPort,
  ) {}

  fundGig(_gigId: string): Promise<EscrowRecordView> {
    throw new NotImplementedException('EscrowService.fundGig — slice 4');
  }

  holdStake(_gigId: string, _solverId: string, _stakeKobo: Kobo): Promise<EscrowRecordView> {
    throw new NotImplementedException('EscrowService.holdStake — slice 6');
  }

  releaseToSolver(_gigId: string): Promise<EscrowRecordView> {
    throw new NotImplementedException('EscrowService.releaseToSolver — slice 7');
  }

  refundPayer(_gigId: string): Promise<EscrowRecordView> {
    throw new NotImplementedException('EscrowService.refundPayer — slice 8 (disputes)');
  }

  freezeForDispute(_gigId: string): Promise<EscrowRecordView> {
    throw new NotImplementedException('EscrowService.freezeForDispute — slice 8');
  }

  resolveFrozen(
    _gigId: string,
    _ruling: 'for_solver' | 'for_payer' | 'split',
  ): Promise<EscrowRecordView> {
    throw new NotImplementedException('EscrowService.resolveFrozen — slice 8');
  }
}
