import { Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OutcomeType, ReputationPort, ReputationView } from './reputation.interface';

/** Skeleton only — first populated by slice 7 (sign-off: reputation +1). */
@Injectable()
export class ReputationService implements ReputationPort {
  constructor(private readonly prisma: PrismaService) {}

  getReputation(_userId: string): Promise<ReputationView> {
    throw new NotImplementedException('ReputationService.getReputation — slice 7');
  }

  recordOutcome(_userId: string, _outcome: OutcomeType): Promise<void> {
    throw new NotImplementedException('ReputationService.recordOutcome — slice 7');
  }
}
