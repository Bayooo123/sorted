import { BadRequestException, ForbiddenException, Injectable, NotFoundException, NotImplementedException } from '@nestjs/common';
import { Dispute } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EscrowService } from '../escrow/escrow.service';
import { GigsService } from '../gigs/gigs.service';
import { Kobo } from '../../common/money';
import { DisputeRecord, DisputeRuling, DisputesPort } from './disputes.interface';

/**
 * Minimal, admin-mediated dispute flow (PLAN.md "Release + sign-off flow"
 * — the "safety net for stuck money" half of that build, alongside
 * EscrowService.releaseToProfessional). No neutral-panel/assignment yet —
 * the founder rules directly via recordRuling (AdminGuard, same pattern as
 * escrow's confirm-funding), which is why assignNeutral stays a stub.
 * "Thin is OK; freeze is not optional" (HANDOFF.md §7) is upheld:
 * raiseDispute calls EscrowService.freezeForDispute inside the SAME
 * transaction as the Dispute row and the Gig status transition — never a
 * freeze with no Dispute row recorded, or vice versa.
 */
@Injectable()
export class DisputesService implements DisputesPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly escrow: EscrowService,
    private readonly gigs: GigsService,
  ) {}

  async raiseDispute(gigId: string, raisedBy: string, reason: string): Promise<DisputeRecord> {
    const gig = await this.gigs.getGig(gigId);
    if (!['claimed', 'in_progress', 'submitted'].includes(gig.status)) {
      throw new BadRequestException(`Cannot raise a dispute on a gig in status "${gig.status}"`);
    }

    const claim = await this.prisma.claim.findFirst({ where: { gigId, status: 'active' } });
    const isClient = gig.clientId === raisedBy;
    const isProfessional = claim?.professionalId === raisedBy;
    if (!isClient && !isProfessional) {
      throw new ForbiddenException('Only the client or the assigned professional can raise a dispute on this gig');
    }

    // Idempotent: a second raise on an already-open dispute just returns
    // it, rather than opening a duplicate — one gig has at most one live
    // dispute at a time in this v1.
    const existingOpen = await this.prisma.dispute.findFirst({
      where: { gigId, status: { in: ['open', 'assigned'] } },
    });
    if (existingOpen) return this.toView(existingOpen);

    const record = await this.prisma.$transaction(async (tx) => {
      const dispute = await tx.dispute.create({
        data: { gigId, raisedById: raisedBy, reason, status: 'open' },
      });
      await this.escrow.freezeForDispute(gigId, tx);
      await this.gigs.transitionStatus(gigId, 'disputed', tx);
      return dispute;
    });

    return this.toView(record);
  }

  assignNeutral(_disputeId: string, _neutralId: string): Promise<DisputeRecord> {
    // v1 deliberately has no neutral panel — the founder rules directly via
    // recordRuling (AdminGuard). Real neutral assignment is a later slice;
    // not designed here, not guessed at.
    throw new NotImplementedException('DisputesService.assignNeutral — no neutral panel in this pilot, see recordRuling');
  }

  async recordRuling(disputeId: string, ruling: DisputeRuling): Promise<DisputeRecord> {
    const dispute = await this.prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute) throw new NotFoundException('Dispute not found');
    if (dispute.status === 'closed') return this.toView(dispute); // idempotent

    // resolveFrozen does its own idempotency/CAS around the actual money
    // movement — this call can safely be retried if it fails partway.
    await this.escrow.resolveFrozen(dispute.gigId, ruling);

    const updated = await this.prisma.dispute.update({
      where: { id: disputeId },
      data: { ruling, status: 'closed' },
    });
    return this.toView(updated);
  }

  applyPenalty(_disputeId: string, _penaltyKobo: Kobo): Promise<DisputeRecord> {
    throw new NotImplementedException('DisputesService.applyPenalty — penalty policy not designed yet, see PLAN.md');
  }

  private toView(dispute: Dispute): DisputeRecord {
    return {
      id: dispute.id,
      gigId: dispute.gigId,
      raisedBy: dispute.raisedById,
      reason: dispute.reason,
      neutralId: dispute.neutralId,
      ruling: dispute.ruling as DisputeRecord['ruling'],
      penaltyKobo: dispute.penaltyKobo != null ? (Number(dispute.penaltyKobo) as Kobo) : null,
      status: dispute.status as DisputeRecord['status'],
    };
  }
}
