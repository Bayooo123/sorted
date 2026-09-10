import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Rating } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GigsService } from '../gigs/gigs.service';
import { ProfessionalRatingSummary, RatingRecord, RatingsPort } from './ratings.interface';

@Injectable()
export class RatingsService implements RatingsPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gigs: GigsService,
  ) {}

  async rateGig(gigId: string, raterId: string, stars: number, comment?: string): Promise<RatingRecord> {
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
      throw new BadRequestException('stars must be a whole number from 1 to 5');
    }

    const gig = await this.gigs.getGig(gigId);
    if (gig.clientId !== raterId) {
      throw new ForbiddenException('Only the client who posted this gig can rate it');
    }
    if (gig.status !== 'released') {
      throw new BadRequestException(`Gig must be released before it can be rated, was "${gig.status}"`);
    }

    // The professional to credit is whoever held the active claim — not
    // stored on the Gig itself (matches how releaseToProfessional/
    // resolveFrozen already look this up), so a rating always attaches to
    // the person actually paid, never inferred from anywhere else.
    const claim = await this.prisma.claim.findFirst({ where: { gigId, status: 'active' } });
    if (!claim) throw new NotFoundException('No active claim for this gig — nobody to rate');

    const rating = await this.prisma.rating.upsert({
      where: { gigId },
      create: { gigId, raterId, rateeId: claim.professionalId, stars, comment: comment ?? null },
      // Upsert, not insert-only — see RatingsPort.rateGig's doc comment.
      update: { stars, comment: comment ?? null },
    });
    return this.toRecord(rating);
  }

  async getProfessionalRatingSummary(professionalId: string): Promise<ProfessionalRatingSummary> {
    const agg = await this.prisma.rating.aggregate({
      where: { rateeId: professionalId },
      _avg: { stars: true },
      _count: true,
    });
    return { average: agg._avg.stars, count: agg._count };
  }

  private toRecord(r: Rating): RatingRecord {
    return {
      gigId: r.gigId,
      raterId: r.raterId,
      rateeId: r.rateeId,
      stars: r.stars,
      comment: r.comment,
      createdAt: r.createdAt,
    };
  }
}
