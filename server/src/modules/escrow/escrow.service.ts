import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, NotImplementedException } from '@nestjs/common';
import { EscrowRecord } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PAYMENTS_PROVIDER, PaymentsProvider } from '../payments/payments.interface';
import { LEDGER_PORT, LedgerPort } from '../ledger/ledger.interface';
import { GigsService } from '../gigs/gigs.service';
import { IdentityService } from '../identity/identity.service';
import { MATCHING_STRATEGY, MatchingStrategy } from '../matching/matching.interface';
import { ConfigService } from '@nestjs/config';
import { Kobo, applyBps, kobo } from '../../common/money';
import { PrismaTx } from '../../common/prisma-tx';
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
    private readonly identity: IdentityService,
    @Inject(PAYMENTS_PROVIDER) private readonly payments: PaymentsProvider,
    @Inject(LEDGER_PORT) private readonly ledger: LedgerPort,
    @Inject(MATCHING_STRATEGY) private readonly matching: MatchingStrategy,
  ) {}

  async fundGig(gigId: string): Promise<EscrowRecordView> {
    const gig = await this.prisma.gig.findUnique({ where: { id: gigId } });
    if (!gig) throw new NotFoundException('Gig not found');
    if (gig.status !== 'escrow_pending') {
      throw new BadRequestException(`Gig must be escrow_pending to fund, was "${gig.status}"`);
    }

    // Idempotent: a gig that already has a holding account (e.g. the
    // client re-opened the funding screen) just gets that same record
    // back instead of a duplicate, error, or a second holding account —
    // this is also why holdingAccountDetails is captured once here and
    // reused on every later read, never recomputed by calling the
    // provider again (a checkout-link provider can't cheaply reconstruct
    // the same link after the fact, unlike a static account number).
    const existing = await this.prisma.escrowRecord.findUnique({ where: { gigId } });
    if (existing) return this.toView(existing);

    const client = await this.identity.getUser(gig.clientId);
    if (!client.email) throw new BadRequestException('Client has no email on file — required to fund a gig');

    const holdingAccount = await this.payments.createHoldingAccount(gigId, kobo(Number(gig.bountyKobo)), client.email);
    const platformFeeBps = Number(this.config.get('DEFAULT_PLATFORM_FEE_BPS') ?? 1000);

    const record = await this.prisma.escrowRecord.create({
      data: {
        gigId,
        provider: holdingAccount.provider,
        holdingAccountRef: holdingAccount.holdingAccountRef,
        holdingAccountDetails: {
          provider: holdingAccount.provider,
          accountNumber: holdingAccount.accountNumber,
          bankName: holdingAccount.bankName,
          checkoutUrl: holdingAccount.checkoutUrl,
        },
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

  async holdStake(gigId: string, professionalId: string): Promise<EscrowRecordView> {
    const gig = await this.gigs.getGig(gigId);
    if (gig.status !== 'open') {
      throw new BadRequestException(`Gig must be open to claim, was "${gig.status}"`);
    }
    await this.identity.assertRole(professionalId, 'professional');

    // v1: trivial accept, no shortlist/bidding — see FixedPriceAcceptStrategy's
    // own doc comment. Called before the transaction below so a future
    // strategy that genuinely needs to reject a claim (shortlist full,
    // professional not eligible) can throw before anything is written.
    await this.matching.assignProfessional(
      { id: gig.id, bountyKobo: gig.bountyKobo, domain: gig.domain, submarket: gig.submarket },
      { gigId, professionalId, staked: false },
    );

    const stakeBps = Number(this.config.get('DEFAULT_STAKE_BPS') ?? 1000);
    const stakeKobo = applyBps(gig.bountyKobo, stakeBps);

    const record = await this.prisma.$transaction(async (tx) => {
      // staked: false is honest, not a placeholder — no real money moves
      // for the stake in this pilot (see PLAN.md "Release + sign-off
      // flow"); stakeKobo below is tracked/displayed only.
      await tx.claim.create({ data: { gigId, professionalId, staked: false, status: 'active' } });

      const updated = await tx.escrowRecord.update({
        where: { gigId },
        data: { stakeKobo: BigInt(stakeKobo), state: 'stake_held', stateChangedAt: new Date() },
      });

      // Two hops, not a shortcut edge in ALLOWED_TRANSITIONS — 'claimed'
      // (professional assigned) and 'in_progress' (work begins) are
      // distinct states in the map; since there's no real stake-payment
      // step to wait on here, this action satisfies both in one call.
      await this.gigs.transitionStatus(gigId, 'claimed', tx);
      await this.gigs.transitionStatus(gigId, 'in_progress', tx);

      return updated;
    });

    return this.toView(record);
  }

  async releaseToProfessional(gigId: string): Promise<EscrowRecordView> {
    const gig = await this.gigs.getGig(gigId);
    if (gig.status !== 'submitted') {
      throw new BadRequestException(`Gig must be submitted to release, was "${gig.status}"`);
    }

    const claim = await this.prisma.claim.findFirst({ where: { gigId, status: 'active' } });
    if (!claim) throw new NotFoundException('No active claim for this gig');

    const existing = await this.prisma.escrowRecord.findUnique({ where: { gigId } });
    if (!existing) throw new NotFoundException('No escrow record for this gig');

    // Idempotent: a released gig (or a disbursement already recorded) is a
    // safe no-op return, never a second payout — see disbursementRef's own
    // schema comment ("double-release protection").
    if (existing.state === 'released' || existing.disbursementRef) {
      return this.toView(existing);
    }

    const destination = await this.identity.getPayoutDestination(claim.professionalId);
    if (!destination) {
      throw new BadRequestException('Professional has not set a payout destination yet');
    }

    // Compare-and-swap into 'releasing' before calling out to the payment
    // provider — an external disburse() call can't be rolled back by a DB
    // transaction, so this claims the release BEFORE the side effect runs,
    // not after. Two concurrent "Approve" taps race here; only one wins
    // (count === 1) and proceeds to actually pay.
    const claimed = await this.prisma.escrowRecord.updateMany({
      where: { gigId, disbursementRef: null, state: { in: ['stake_held', 'releasing'] } },
      data: { state: 'releasing', stateChangedAt: new Date() },
    });
    if (claimed.count === 0) {
      const current = await this.prisma.escrowRecord.findUniqueOrThrow({ where: { gigId } });
      return this.toView(current);
    }

    const feeKobo = applyBps(gig.bountyKobo, existing.platformFeeBps);
    const professionalPayoutKobo = kobo(gig.bountyKobo - feeKobo);
    const idempotencyKey = `release:${gigId}`;

    let disbursementRef: string;
    try {
      const result = await this.payments.disburse(
        [
          {
            destinationRef: JSON.stringify(destination),
            amountKobo: professionalPayoutKobo,
            narration: `Sorted gig ${gigId} payout`,
          },
        ],
        idempotencyKey,
      );
      disbursementRef = result.disbursementRef;
    } catch (err) {
      // Left in 'releasing' with no disbursementRef on purpose — the CAS
      // above lets a retried call (client taps "Approve" again) attempt
      // disburse() again instead of getting stuck. See this method's own
      // idempotency guard above.
      throw new BadRequestException(
        `Disbursement failed, gig left in 'releasing' for retry: ${err instanceof Error ? err.message : err}`,
      );
    }

    const record = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.escrowRecord.update({
        where: { gigId },
        data: {
          state: 'released',
          feeKobo: BigInt(feeKobo),
          professionalPayoutKobo: BigInt(professionalPayoutKobo),
          disbursementRef,
          stateChangedAt: new Date(),
        },
      });

      await this.gigs.transitionStatus(gigId, 'signed_off', tx);
      await this.gigs.transitionStatus(gigId, 'released', tx);

      await this.ledger.record(
        {
          gigId,
          type: 'release',
          amountKobo: professionalPayoutKobo,
          direction: 'out',
          providerRef: disbursementRef,
          eventId: `release:${gigId}`,
        },
        tx,
      );
      await this.ledger.record(
        {
          gigId,
          type: 'fee',
          amountKobo: feeKobo,
          direction: 'out',
          providerRef: disbursementRef,
          eventId: `fee:${gigId}`,
        },
        tx,
      );

      return updated;
    });

    return this.toView(record);
  }

  async refundClient(gigId: string): Promise<EscrowRecordView> {
    const gig = await this.gigs.getGig(gigId);
    const existing = await this.prisma.escrowRecord.findUnique({ where: { gigId } });
    if (!existing) throw new NotFoundException('No escrow record for this gig');

    if (existing.state === 'refunded') return this.toView(existing); // idempotent

    if (!['escrow_pending', 'disputed'].includes(gig.status)) {
      throw new BadRequestException(`Cannot refund a gig in status "${gig.status}"`);
    }
    if (!['funded', 'stake_held', 'dispute_hold'].includes(existing.state)) {
      throw new BadRequestException(`Cannot refund from escrow state "${existing.state}"`);
    }

    // disbursementRef doubles as the CAS lock for both release AND refund
    // — a gig only ever settles once, in one direction or the other, so
    // "already has a ref" means "don't do this again" either way. Written
    // as a placeholder here (not the real ref yet) since refund() is an
    // external call that can't be rolled back by a DB transaction; reset
    // to null on failure below so a retry isn't permanently locked out.
    const claimed = await this.prisma.escrowRecord.updateMany({
      where: { gigId, disbursementRef: null },
      data: { disbursementRef: 'pending' },
    });
    if (claimed.count === 0) {
      const current = await this.prisma.escrowRecord.findUniqueOrThrow({ where: { gigId } });
      return this.toView(current);
    }

    let refundRef: string;
    try {
      const result = await this.payments.refund(existing.holdingAccountRef ?? gigId);
      refundRef = result.refundRef;
    } catch (err) {
      await this.prisma.escrowRecord.update({ where: { gigId }, data: { disbursementRef: null } });
      throw new BadRequestException(`Refund failed: ${err instanceof Error ? err.message : err}`);
    }

    const record = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.escrowRecord.update({
        where: { gigId },
        data: { state: 'refunded', disbursementRef: refundRef, stateChangedAt: new Date() },
      });
      await this.gigs.transitionStatus(gigId, 'refunded', tx);
      await this.ledger.record(
        {
          gigId,
          type: 'refund',
          amountKobo: kobo(Number(existing.bountyKobo)),
          direction: 'out',
          providerRef: refundRef,
          eventId: `refund:${gigId}`,
        },
        tx,
      );
      return updated;
    });

    return this.toView(record);
  }

  async freezeForDispute(gigId: string, tx?: PrismaTx): Promise<EscrowRecordView> {
    const client = tx ?? this.prisma;
    const existing = await client.escrowRecord.findUnique({ where: { gigId } });
    if (!existing) throw new NotFoundException('No escrow record for this gig');
    if (existing.state === 'dispute_hold') return this.toView(existing); // idempotent
    if (existing.state !== 'stake_held') {
      throw new BadRequestException(`Cannot freeze for dispute from escrow state "${existing.state}"`);
    }
    const record = await client.escrowRecord.update({
      where: { gigId },
      data: { state: 'dispute_hold', stateChangedAt: new Date() },
    });
    return this.toView(record);
  }

  async resolveFrozen(
    gigId: string,
    ruling: 'for_professional' | 'for_client' | 'split',
  ): Promise<EscrowRecordView> {
    const existing = await this.prisma.escrowRecord.findUnique({ where: { gigId } });
    if (!existing) throw new NotFoundException('No escrow record for this gig');
    if (existing.state === 'released' || existing.state === 'refunded') return this.toView(existing); // idempotent
    if (existing.state !== 'dispute_hold') {
      throw new BadRequestException(`Gig is not in dispute_hold, was "${existing.state}"`);
    }

    if (ruling === 'split') {
      // Genuinely undesigned, not an oversight: how fee applies to a
      // partial payout/refund is its own product decision (does Sorted
      // still take 10% of the professional's half? Of the whole bounty?).
      // Deferred rather than guessed — see PLAN.md "Release + sign-off
      // flow". 'for_professional' / 'for_client' cover the common cases.
      throw new NotImplementedException(
        "EscrowService.resolveFrozen('split') — fee treatment on a partial payout/refund isn't designed yet. Use 'for_professional' or 'for_client'.",
      );
    }

    if (ruling === 'for_client') {
      return this.refundClient(gigId);
    }

    // for_professional: same disbursement mechanics as releaseToProfessional,
    // just entered from dispute_hold instead of submitted — 'disputed' ->
    // 'released' is a direct hop in ALLOWED_TRANSITIONS (no signed_off step).
    const gig = await this.gigs.getGig(gigId);
    const claim = await this.prisma.claim.findFirst({ where: { gigId, status: 'active' } });
    if (!claim) throw new NotFoundException('No active claim for this gig');
    const destination = await this.identity.getPayoutDestination(claim.professionalId);
    if (!destination) throw new BadRequestException('Professional has not set a payout destination yet');

    const claimed = await this.prisma.escrowRecord.updateMany({
      where: { gigId, disbursementRef: null, state: 'dispute_hold' },
      data: { state: 'releasing', stateChangedAt: new Date() },
    });
    if (claimed.count === 0) {
      const current = await this.prisma.escrowRecord.findUniqueOrThrow({ where: { gigId } });
      return this.toView(current);
    }

    const feeKobo = applyBps(gig.bountyKobo, existing.platformFeeBps);
    const professionalPayoutKobo = kobo(gig.bountyKobo - feeKobo);

    let disbursementRef: string;
    try {
      const result = await this.payments.disburse(
        [
          {
            destinationRef: JSON.stringify(destination),
            amountKobo: professionalPayoutKobo,
            narration: `Sorted gig ${gigId} dispute payout`,
          },
        ],
        `dispute-release:${gigId}`,
      );
      disbursementRef = result.disbursementRef;
    } catch (err) {
      throw new BadRequestException(
        `Disbursement failed, gig left in 'releasing' for retry: ${err instanceof Error ? err.message : err}`,
      );
    }

    const record = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.escrowRecord.update({
        where: { gigId },
        data: {
          state: 'released',
          feeKobo: BigInt(feeKobo),
          professionalPayoutKobo: BigInt(professionalPayoutKobo),
          disbursementRef,
          stateChangedAt: new Date(),
        },
      });
      await this.gigs.transitionStatus(gigId, 'released', tx);
      await this.ledger.record(
        {
          gigId,
          type: 'release',
          amountKobo: professionalPayoutKobo,
          direction: 'out',
          providerRef: disbursementRef,
          eventId: `dispute-release:${gigId}`,
        },
        tx,
      );
      await this.ledger.record(
        {
          gigId,
          type: 'fee',
          amountKobo: feeKobo,
          direction: 'out',
          providerRef: disbursementRef,
          eventId: `dispute-fee:${gigId}`,
        },
        tx,
      );
      return updated;
    });

    return this.toView(record);
  }

  private toView(record: EscrowRecord): EscrowRecordView {
    return {
      gigId: record.gigId,
      state: record.state as EscrowState,
      bountyKobo: kobo(Number(record.bountyKobo)),
      stakeKobo: kobo(Number(record.stakeKobo)),
      platformFeeBps: record.platformFeeBps,
      holdingAccount: record.holdingAccountDetails as EscrowRecordView['holdingAccount'],
    };
  }
}
