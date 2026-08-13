import { Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateGigInput,
  GigListFilter,
  GigRecord,
  GigsPort,
  GigStatus,
} from './gigs.interface';

/**
 * Skeleton only — slice 3 in HANDOFF.md §7 implements this body (post-a-gig,
 * criteria lock, source field, taxonomy seed tables).
 *
 * Status transitions must be enforced server-side against an allowed-
 * transition map (HANDOFF.md §9) — do not implement transitionStatus as an
 * unchecked write when slice 3 lands.
 */
@Injectable()
export class GigsService implements GigsPort {
  constructor(private readonly prisma: PrismaService) {}

  createGig(_input: CreateGigInput): Promise<GigRecord> {
    throw new NotImplementedException('GigsService.createGig — slice 3');
  }

  publishGig(_gigId: string): Promise<GigRecord> {
    throw new NotImplementedException('GigsService.publishGig — slice 3');
  }

  getGig(_gigId: string): Promise<GigRecord> {
    throw new NotImplementedException('GigsService.getGig — slice 3');
  }

  transitionStatus(_gigId: string, _to: GigStatus): Promise<GigRecord> {
    throw new NotImplementedException('GigsService.transitionStatus — slice 3');
  }

  listGigs(_filter: GigListFilter): Promise<GigRecord[]> {
    throw new NotImplementedException('GigsService.listGigs — slice 5 (market/browse)');
  }
}
