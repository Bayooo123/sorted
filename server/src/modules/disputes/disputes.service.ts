import { Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EscrowService } from '../escrow/escrow.service';
import { Kobo } from '../../common/money';
import { DisputeRecord, DisputeRuling, DisputesPort } from './disputes.interface';

/**
 * Skeleton only — slice 8 in HANDOFF.md §7. "Thin is OK; freeze is not
 * optional": raiseDispute MUST call EscrowService.freezeForDispute() in the
 * same operation, and recordRuling MUST call EscrowService.resolveFrozen()
 * with the same ruling — never let Disputes and Escrow state drift apart.
 */
@Injectable()
export class DisputesService implements DisputesPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly escrow: EscrowService,
  ) {}

  raiseDispute(_gigId: string, _raisedBy: string, _reason: string): Promise<DisputeRecord> {
    throw new NotImplementedException('DisputesService.raiseDispute — slice 8');
  }

  assignNeutral(_disputeId: string, _neutralId: string): Promise<DisputeRecord> {
    throw new NotImplementedException('DisputesService.assignNeutral — slice 8');
  }

  recordRuling(_disputeId: string, _ruling: DisputeRuling): Promise<DisputeRecord> {
    throw new NotImplementedException('DisputesService.recordRuling — slice 8');
  }

  applyPenalty(_disputeId: string, _penaltyKobo: Kobo): Promise<DisputeRecord> {
    throw new NotImplementedException('DisputesService.applyPenalty — slice 8');
  }
}
