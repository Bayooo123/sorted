import { Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Kobo } from '../../common/money';
import { LedgerEntryInput, LedgerEntryView, LedgerPort } from './ledger.interface';

/**
 * Skeleton only — implemented alongside slice 4 (first entries: fund). No
 * update/delete path should ever be added here; record() is the only write.
 * event_id carries a unique DB constraint (prisma/schema.prisma) so a
 * replayed webhook's record() call is a safe no-op, not a duplicate row.
 */
@Injectable()
export class LedgerService implements LedgerPort {
  constructor(private readonly prisma: PrismaService) {}

  record(_entry: LedgerEntryInput): Promise<LedgerEntryView> {
    throw new NotImplementedException('LedgerService.record — slice 4');
  }

  getGigLedger(_gigId: string): Promise<LedgerEntryView[]> {
    throw new NotImplementedException('LedgerService.getGigLedger — slice 4');
  }

  getBalance(_gigId: string): Promise<Kobo> {
    throw new NotImplementedException('LedgerService.getBalance — slice 4');
  }
}
