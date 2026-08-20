import { BadRequestException, Inject, Injectable, NotFoundException, NotImplementedException } from '@nestjs/common';
import { Gig } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { IdentityService } from '../identity/identity.service';
import { MATCHING_STRATEGY, MatchingStrategy } from '../matching/matching.interface';
import { kobo } from '../../common/money';
import {
  CreateGigInput,
  GigListFilter,
  GigRecord,
  GigsPort,
  GigStatus,
} from './gigs.interface';

/**
 * HANDOFF.md §9: "Gig.status via allowed-transition map (server-enforced)."
 * Deliberately conservative — most of these targets aren't reachable yet
 * (their owning slice isn't built), but the map is written for the whole
 * lifecycle now so later slices call transitionStatus() against a rule
 * that's already reviewed, instead of each slice inventing its own checks.
 */
const ALLOWED_TRANSITIONS: Record<GigStatus, GigStatus[]> = {
  draft: ['escrow_pending', 'cancelled'],
  escrow_pending: ['open', 'refunded', 'cancelled'], // slice 4: funded -> open, or funding fails/times out
  open: ['claimed', 'cancelled'],
  claimed: ['in_progress', 'disputed'],
  in_progress: ['submitted', 'disputed'],
  submitted: ['signed_off', 'disputed'],
  signed_off: ['released'],
  disputed: ['released', 'refunded'],
  released: [],
  refunded: [],
  cancelled: [],
};

@Injectable()
export class GigsService implements GigsPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    @Inject(MATCHING_STRATEGY) private readonly matchingStrategy: MatchingStrategy,
  ) {}

  async createGig(input: CreateGigInput): Promise<GigRecord> {
    await this.identity.assertRole(input.clientId, 'client');

    if (!input.criteria || input.criteria.length === 0) {
      throw new BadRequestException('A gig needs at least one criterion');
    }
    if (input.bountyKobo <= 0) {
      throw new BadRequestException('bountyKobo must be greater than zero');
    }

    const [domain, submarket, clientType] = await Promise.all([
      this.prisma.domain.findUnique({ where: { key: input.domain } }),
      this.prisma.submarket.findUnique({ where: { key: input.submarket } }),
      this.prisma.clientTypeRef.findUnique({ where: { key: input.clientType } }),
    ]);
    if (!domain) throw new BadRequestException(`Unknown domain "${input.domain}"`);
    if (!submarket) throw new BadRequestException(`Unknown submarket "${input.submarket}"`);
    if (!clientType) throw new BadRequestException(`Unknown clientType "${input.clientType}"`);

    // SEAM (§3.3): pricing always goes through MatchingStrategy, even
    // though v1's FixedPriceAccept is a pass-through of the client's
    // number. Swapping to reverse-auction/dynamic pricing later changes
    // what this call resolves to, not this call site.
    const pricing = await this.matchingStrategy.priceGig({
      id: '', // gig doesn't exist yet; v1's strategy ignores it, kept for strategies that will need it
      bountyKobo: input.bountyKobo,
      domain: input.domain,
      submarket: input.submarket,
    });

    const gig = await this.prisma.gig.create({
      data: {
        clientId: input.clientId,
        source: 'self_posted',
        templateId: input.templateId ?? null,
        title: input.title,
        description: input.description,
        domainId: domain.id,
        submarketId: submarket.id,
        clientTypeId: clientType.id,
        locationText: input.locationText,
        locationGeoLat: input.locationGeo?.lat,
        locationGeoLng: input.locationGeo?.lng,
        materialsMode: input.materialsMode,
        bountyKobo: BigInt(pricing.finalPriceKobo),
        status: 'draft',
        matchingStrategy: this.matchingStrategy.name,
        criteria: {
          create: input.criteria.map((text, orderIndex) => ({ orderIndex, text, locked: false })),
        },
      },
    });

    return this.toGigRecord(gig);
  }

  async publishGig(gigId: string): Promise<GigRecord> {
    const gig = await this.prisma.gig.findUnique({ where: { id: gigId } });
    if (!gig) throw new NotFoundException('Gig not found');
    this.assertTransitionAllowed(gig.status as GigStatus, 'escrow_pending');

    // Criterion.locked flips inside the same transaction as the status
    // change (HANDOFF.md §3.2: "locked ★ true at publish, immutable
    // thereafter — server-enforced") — a crash between the two would
    // otherwise leave criteria unlocked on a gig that looks published.
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.criterion.updateMany({ where: { gigId }, data: { locked: true } });
      return tx.gig.update({
        where: { id: gigId },
        data: { status: 'escrow_pending', publishedAt: new Date() },
      });
    });

    return this.toGigRecord(updated);
  }

  async getGig(gigId: string): Promise<GigRecord> {
    const gig = await this.prisma.gig.findUnique({ where: { id: gigId } });
    if (!gig) throw new NotFoundException('Gig not found');
    return this.toGigRecord(gig);
  }

  async transitionStatus(gigId: string, to: GigStatus): Promise<GigRecord> {
    const gig = await this.prisma.gig.findUnique({ where: { id: gigId } });
    if (!gig) throw new NotFoundException('Gig not found');
    this.assertTransitionAllowed(gig.status as GigStatus, to);

    const updated = await this.prisma.gig.update({ where: { id: gigId }, data: { status: to } });
    return this.toGigRecord(updated);
  }

  listGigs(_filter: GigListFilter): Promise<GigRecord[]> {
    throw new NotImplementedException('GigsService.listGigs — slice 5 (market/browse)');
  }

  private assertTransitionAllowed(from: GigStatus, to: GigStatus): void {
    if (!ALLOWED_TRANSITIONS[from]?.includes(to)) {
      throw new BadRequestException(`Cannot transition gig from "${from}" to "${to}"`);
    }
  }

  private toGigRecord(gig: Gig): GigRecord {
    return {
      id: gig.id,
      clientId: gig.clientId,
      source: gig.source as GigRecord['source'],
      templateId: gig.templateId,
      status: gig.status as GigStatus,
      bountyKobo: kobo(Number(gig.bountyKobo)),
      matchingStrategy: gig.matchingStrategy,
    };
  }
}
