import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, NotImplementedException } from '@nestjs/common';
import { EscrowRecord } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PAYMENTS_PROVIDER, PaymentsProvider } from '../payments/payments.interface';
import { LEDGER_PORT, LedgerPort } from '../ledger/ledger.interface';
import { GigsService } from '../gigs/gigs.service';
import { ConfigService } from '@nestjs/config';
import { Kobo, kobo } from '../../common/money';
import { EscrowPort, EscrowRecordView, EscrowState } from './escrow.interface';

/**
 * fundGig/confirmFunding implemented for the manual-pilot funding flow
 * (PLAN.md's "Manual escrow pilot" section) — the rest (holdStake,
 * releaseToProfessional, refundClient, freezeForDispute, resolveFrozen)
 * stay stubs until their owning slice, same as before.
 *
 * Non-negotiables from HANDOFF.md §9, upheld here:
 *   - confirmFunding writes the EscrowRecord state change, the Gig status
 *     transition, and the LedgerEntry inside ONE DB transaction (PrismaTx
 *     threaded through GigsService.transitionStatus and LedgerService.record)
 *     — all-or-nothing, not three separate round-trips;
 *   - the LedgerEntry's eventId is deterministic per gig
     (`fund:${gigId}`), so a duplicate confirmFunding call is a no-op via
 *     LedgerService's upsert, not a double-credit;
 *   - no transition out of dispute_hold except through resolveFrozen()
 *     (unchanged — not reachable yet, no code path skips it);
 *   - this service calls PaymentsProvider only through the injected
 *     interface — never a concrete provider class.
 */
@Injectable()
export class EscrowService implements EscrowPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly gigs: GigsService,
    @Inject(PAYMENTS_PROVIDER) private readonly payments: PaymentsProvider,
    @Inject(LEDGER_PORT) private readonly ledger: LedgerPort,
  ) {}

  async fundGig(gigId: string): Promise<EscrowRecordView> {
    const gig = await this.prisma.gig.findUnique({ where: { id: gigId } });
    if (!gig) throw new NotFoundException('Gig not found');
    if (gig.status !== 'escrow_pending') {
      throw new BadRequestException(`Gig must be escrow_pending to fund, was "${gig.status}"`);
    }

    // Idempotent: a gig that already has a holding account (e.g. the
    // client re-opened the funding screen) just gets that same record
    // back instead of a duplicate, error, or a second holding account.
    const existing = await this.prisma.escrowRecord.findUnique({ where: { gigId } });
    if (existing) return this.toView(existing);

    const holdingAccount = await this.payments.createHoldingAccount(gigId);
    const platformFeeBps = Number(this.config.get('DEFAULT_PLATFORM_FEE_BPS') ?? 1000);

    const record = await this.prisma.escrowRecord.create({
      data: {
        gigId,
        provider: holdingAccount.provider,
        holdingAccountRef: holdingAccount.holdingAccountRef,
        bountyKobo: gig.bountyKobo,
        platformFeeBps,
        state: 'awaiting_funding',
      },
    });

    return this.toView(record);
  }

  async confirmFunding(gigId: string, providerRef: string): Promise<EscrowRecordView> {
    const result = await this.prisma.$transaction(async (tx) => {
      const record = await tx.escrowRecord.findUnique({ where: { gigId } });
      if (!record) throw new NotFoundException('No escrow record for this gig — call fundGig first');

      // Idempotent: confirming an already-funded gig just returns its
      // current state rather than erroring — an admin double-clicking
      // "confirm" shouldn't be able to break anything.
      if (record.state !== 'awaiting_funding') {
        return record;
      }

      const updated = await tx.escrowRecord.update({
        where: { gigId },
        data: { state: 'funded', stateChangedAt: new Date() },
      });

      await this.gigs.transitionStatus(gigId, 'open', tx);

      await this.ledger.record(
        {
          gigId,
          type: 'fund',
          amountKobo: kobo(Number(record.bountyKobo)),
          direction: 'in',
          providerRef,
          eventId: `fund:${gigId}`,
        },
        tx,
      );

      return updated;
    });

    return this.toView(result);
  }

  async getEscrow(gigId: string): Promise<EscrowRecordView> {
    const record = await this.prisma.escrowRecord.findUnique({ where: { gigId } });
    if (!record) throw new NotFoundException('No escrow record for this gig');
    return this.toView(record);
  }

  holdStake(_gigId: string, _professionalId: string, _stakeKobo: Kobo): Promise<EscrowRecordView> {
    throw new NotImplementedException('EscrowService.holdStake — slice 6');
  }

  releaseToProfessional(_gigId: string): Promise<EscrowRecordView> {
    throw new NotImplementedException('EscrowService.releaseToProfessional — slice 7');
  }

  refundClient(_gigId: string): Promise<EscrowRecordView> {
    throw new NotImplementedException('EscrowService.refundClient — slice 8 (disputes)');
  }

  freezeForDispute(_gigId: string): Promise<EscrowRecordView> {
    throw new NotImplementedException('EscrowService.freezeForDispute — slice 8');
  }

  resolveFrozen(
    _gigId: string,
    _ruling: 'for_professional' | 'for_client' | 'split',
  ): Promise<EscrowRecordView> {
    throw new NotImplementedException('EscrowService.resolveFrozen — slice 8');
  }

  private toView(record: EscrowRecord): EscrowRecordView {
    return {
      gigId: record.gigId,
      state: record.state as EscrowState,
      bountyKobo: kobo(Number(record.bountyKobo)),
      stakeKobo: kobo(Number(record.stakeKobo)),
      platformFeeBps: record.platformFeeBps,
    };
  }
}
