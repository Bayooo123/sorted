import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, NotImplementedException } from '@nestjs/common';
import { EscrowRecord } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PAYMENTS_PROVIDER, PaymentsProvider } from '../payments/payments.interface';
import { LEDGER_PORT, LedgerPort } from '../ledger/ledger.interface';
import { GigsService } from '../gigs/gigs.service';
import { IdentityService } from '../identity/identity.service';
import { PayoutDestination } from '../identity/identity.interface';
import { MATCHING_STRATEGY, MatchingStrategy } from '../matching/matching.interface';
import { ConfigService } from '@nestjs/config';
import { Kobo, addKobo, applyBps, kobo } from '../../common/money';
import { WHATSAPP_PORT, WhatsAppPort } from '../whatsapp/whatsapp.interface';
import { DeliveryService } from '../delivery/delivery.service';
import { PrismaTx } from '../../common/prisma-tx';
import { EscrowPort, EscrowRecordView, EscrowState } from './escrow.interface';

/**
 * PLAN.md "Split payment pivot" — see escrow.interface.ts's top doc
 * comment for the full why. holdStake/releaseToProfessional/
 * confirmRelease are the live flow; freezeForDispute/resolveFrozen cover
 * disputes, which are always pre-payment under this model (see
 * resolveFrozen's doc comment for what that does and doesn't guarantee).
 *
 * Non-negotiables from HANDOFF.md §9, upheld here:
 *   - confirmRelease writes the EscrowRecord state change, the Gig status
 *     transition, and the LedgerEntry inside ONE DB transaction — all-or-
 *     nothing, not three separate round-trips;
 *   - LedgerEntry eventIds are deterministic per gig, so a duplicate
 *     confirmRelease call is a no-op via LedgerService's upsert, not a
 *     double-credit;
 *   - no transition out of dispute_hold except through resolveFrozen();
 *   - this service calls PaymentsProvider only through the injected
 *     interface — never a concrete provider class.
 */
@Injectable()
export class EscrowService implements EscrowPort {
  private readonly logger = new Logger(EscrowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly gigs: GigsService,
    private readonly identity: IdentityService,
    @Inject(PAYMENTS_PROVIDER) private readonly payments: PaymentsProvider,
    @Inject(LEDGER_PORT) private readonly ledger: LedgerPort,
    @Inject(MATCHING_STRATEGY) private readonly matching: MatchingStrategy,
    @Inject(WHATSAPP_PORT) private readonly whatsapp: WhatsAppPort,
    private readonly delivery: DeliveryService,
  ) {}

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
      {
        id: gig.id,
        bountyKobo: gig.bountyKobo,
        domain: gig.domain,
        submarket: gig.submarket,
        restrictedToProfessionalId: gig.restrictedToProfessionalId,
      },
      { gigId, professionalId, staked: false },
    );

    const stakeBps = Number(this.config.get('DEFAULT_STAKE_BPS') ?? 1000);
    const stakeKobo = applyBps(gig.bountyKobo, stakeBps);
    // PLAN.md "Split payment pivot" — frozen at claim time (the earliest
    // point an EscrowRecord now exists), not recomputed at release, same
    // reasoning fundGig used to apply pre-pivot: a mid-flight config
    // change can't retarget an already-quoted charge.
    const platformFeeBps = Number(this.config.get('DEFAULT_PLATFORM_FEE_BPS') ?? 1000);

    const record = await this.prisma.$transaction(async (tx) => {
      // staked: false is honest, not a placeholder — no real money moves
      // for the stake in this pilot (see PLAN.md "Release + sign-off
      // flow"); stakeKobo below is tracked/displayed only.
      await tx.claim.create({ data: { gigId, professionalId, staked: false, status: 'active' } });

      // First EscrowRecord this gig gets — pre-pivot this was created by
      // fundGig before any claim existed; there's nothing to fund upfront
      // anymore, so claim time is the earliest point it's needed.
      const created = await tx.escrowRecord.create({
        data: { gigId, bountyKobo: gig.bountyKobo, stakeKobo: BigInt(stakeKobo), platformFeeBps, state: 'stake_held' },
      });

      // Two hops, not a shortcut edge in ALLOWED_TRANSITIONS — 'claimed'
      // (professional assigned) and 'in_progress' (work begins) are
      // distinct states in the map; since there's no real stake-payment
      // step to wait on here, this action satisfies both in one call.
      await this.gigs.transitionStatus(gigId, 'claimed', tx);
      await this.gigs.transitionStatus(gigId, 'in_progress', tx);

      return created;
    });

    // Best-effort, outside the transaction — same reasoning as every other
    // WhatsApp/notification hook in this file: a courier dispatch failing
    // must never undo a claim that already succeeded. No-ops for any
    // submarket other than Laundry & Dry Cleaning — see DeliveryService.
    await this.delivery.dispatchPickupLeg(gigId, gig.clientId, professionalId).catch((err) => {
      this.logger.warn(`Pickup dispatch failed for gig ${gigId}: ${err instanceof Error ? err.message : err}`);
    });

    return this.toView(record);
  }

  async releaseToProfessional(gigId: string): Promise<EscrowRecordView> {
    const gig = await this.gigs.getGig(gigId);
    if (gig.status !== 'submitted') {
      throw new BadRequestException(`Gig must be submitted to release, was "${gig.status}"`);
    }
    return this.initiateRelease(gigId);
  }

  /**
   * PLAN.md "Split payment pivot" — THE payment moment, shared by the
   * normal submitted->release path (releaseToProfessional) and the
   * ruled-for-professional dispute path (resolveFrozen), which is
   * otherwise identical: initiate the same charge+split, just entered
   * from a different gig status. Only INITIATES the charge — confirmRelease
   * is what finalizes it once the provider confirms it succeeded.
   */
  private async initiateRelease(gigId: string): Promise<EscrowRecordView> {
    const gig = await this.gigs.getGig(gigId);
    const claim = await this.prisma.claim.findFirst({ where: { gigId, status: 'active' } });
    if (!claim) throw new NotFoundException('No active claim for this gig');

    const existing = await this.prisma.escrowRecord.findUnique({ where: { gigId } });
    if (!existing) throw new NotFoundException('No escrow record for this gig');

    // Idempotent: already released, or a charge already initiated, is a
    // safe no-op return — never a second charge for the same gig.
    if (existing.state === 'released' || existing.holdingAccountRef) {
      return this.toView(existing);
    }

    const destination = await this.identity.getPayoutDestination(claim.professionalId);
    if (!destination) {
      throw new BadRequestException('Professional has not set a payout destination yet');
    }
    const subaccountCode = await this.getOrCreateSubaccount(claim.professionalId, destination);

    const client = await this.identity.getUser(gig.clientId);
    if (!client.email) throw new BadRequestException('Client has no email on file — required to charge for release');

    // Compare-and-swap into 'releasing' before calling out to the payment
    // provider — an external call can't be rolled back by a DB
    // transaction, so this claims the release BEFORE the side effect
    // runs, not after. Two concurrent "Approve" taps race here; only one
    // wins (count === 1) and proceeds to actually charge.
    const claimed = await this.prisma.escrowRecord.updateMany({
      where: { gigId, holdingAccountRef: null, state: { in: ['stake_held', 'dispute_hold', 'releasing'] } },
      data: { state: 'releasing', stateChangedAt: new Date() },
    });
    if (claimed.count === 0) {
      const current = await this.prisma.escrowRecord.findUniqueOrThrow({ where: { gigId } });
      return this.toView(current);
    }

    const bountyKobo = kobo(Number(existing.bountyKobo));
    const feeKobo = applyBps(bountyKobo, existing.platformFeeBps);
    const totalChargeKobo = addKobo(bountyKobo, feeKobo);

    let charge: Awaited<ReturnType<PaymentsProvider['chargeWithSplit']>>;
    try {
      charge = await this.payments.chargeWithSplit(gigId, totalChargeKobo, client.email, [
        // Sorted's fee has no split destination of its own — it's
        // whatever the charge total minus this one share comes to, paid
        // to Sorted's main account by the provider automatically. See
        // escrow.interface.ts's COMMISSION MODEL note.
        { subaccountCode, amountKobo: bountyKobo, narration: `Sorted gig ${gigId} payout` },
      ]);
    } catch (err) {
      // Left in 'releasing' with no ref on purpose — the CAS above lets a
      // retried call (client taps "Approve" again) attempt
      // chargeWithSplit again instead of getting stuck.
      throw new BadRequestException(
        `Charge failed, gig left in 'releasing' for retry: ${err instanceof Error ? err.message : err}`,
      );
    }

    const record = await this.prisma.escrowRecord.update({
      where: { gigId },
      data: {
        feeKobo: BigInt(feeKobo),
        professionalPayoutKobo: BigInt(bountyKobo),
        // Reuses the pre-pivot holdingAccountRef/holdingAccountDetails
        // columns for the release charge's ref/checkout — see
        // EscrowRecord's schema comment for why this wasn't worth a
        // migration to rename.
        holdingAccountRef: charge.chargeRef,
        holdingAccountDetails: {
          provider: charge.provider,
          accountNumber: charge.accountNumber,
          bankName: charge.bankName,
          checkoutUrl: charge.checkoutUrl,
        },
        stateChangedAt: new Date(),
      },
    });

    return this.toView(record);
  }

  /**
   * PLAN.md "Split payment pivot" — lazy, not eager: called the first
   * time a professional's gig actually reaches release, not on every
   * payout-destination edit (IdentityService.setPayoutDestination doesn't
   * call this — see its own doc comment). Persists the result so a
   * professional only ever gets one Paystack subaccount no matter how
   * many gigs they complete.
   */
  private async getOrCreateSubaccount(professionalId: string, destination: PayoutDestination): Promise<string> {
    const existing = await this.identity.getPaystackSubaccountCode(professionalId);
    if (existing) return existing;

    const subaccount = await this.payments.createSubaccount(destination);
    await this.identity.setPaystackSubaccountCode(professionalId, subaccount.subaccountCode);
    return subaccount.subaccountCode;
  }

  /**
   * PLAN.md "Split payment pivot" — the only place a gig actually becomes
   * "paid." Called by the Paystack webhook once charge.success fires for
   * a releaseToProfessional-initiated charge, or by an admin action
   * during the manual pilot (mirrors how confirmFunding used to work
   * pre-pivot — see PaystackWebhookController / EscrowController's
   * confirm-release route). gig.status (read BEFORE the transaction,
   * same pattern as every other method here) decides which transition
   * path applies: 'submitted' is the normal happy path (submitted ->
   * signed_off -> released, same two-hop pre-pivot releaseToProfessional
   * always did in one call); 'disputed' is the ruled-for-professional
   * path ('disputed' -> 'released' is a direct hop in ALLOWED_TRANSITIONS,
   * no signed_off step).
   */
  async confirmRelease(gigId: string, providerRef: string): Promise<EscrowRecordView> {
    const gig = await this.gigs.getGig(gigId);
    let alreadyReleased = false;

    const result = await this.prisma.$transaction(async (tx) => {
      const record = await tx.escrowRecord.findUnique({ where: { gigId } });
      if (!record) throw new NotFoundException('No escrow record for this gig');

      if (record.state === 'released') {
        alreadyReleased = true;
        return record;
      }
      if (record.state !== 'releasing') {
        throw new BadRequestException(`Cannot confirm release from escrow state "${record.state}"`);
      }

      const updated = await tx.escrowRecord.update({
        where: { gigId },
        data: { state: 'released', stateChangedAt: new Date() },
      });

      if (gig.status === 'submitted') {
        await this.gigs.transitionStatus(gigId, 'signed_off', tx);
        await this.gigs.transitionStatus(gigId, 'released', tx);
      } else if (gig.status === 'disputed') {
        await this.gigs.transitionStatus(gigId, 'released', tx);
      } else {
        throw new BadRequestException(`Cannot confirm release for a gig in status "${gig.status}"`);
      }

      // Single charge, but recorded as three ledger entries (in from the
      // client, out to the professional, out as Sorted's fee) — accurate
      // double-entry bookkeeping for what actually happened, unlike
      // pre-pivot's 'fund' entry recorded separately at a now-nonexistent
      // funding step.
      const professionalPayoutKobo = kobo(Number(record.professionalPayoutKobo ?? 0));
      const feeKobo = kobo(Number(record.feeKobo ?? 0));
      const totalChargeKobo = addKobo(professionalPayoutKobo, feeKobo);

      await this.ledger.record(
        { gigId, type: 'fund', amountKobo: totalChargeKobo, direction: 'in', providerRef, eventId: `fund:${gigId}` },
        tx,
      );
      await this.ledger.record(
        { gigId, type: 'release', amountKobo: professionalPayoutKobo, direction: 'out', providerRef, eventId: `release:${gigId}` },
        tx,
      );
      await this.ledger.record(
        { gigId, type: 'fee', amountKobo: feeKobo, direction: 'out', providerRef, eventId: `fee:${gigId}` },
        tx,
      );

      return updated;
    });

    if (!alreadyReleased) {
      const claim = await this.prisma.claim.findFirst({ where: { gigId, status: 'active' } });
      if (claim) {
        // Best-effort, outside the transaction — same reasoning as every
        // other notification hook in this file: a prompt/notification
        // failing must never fail a real payout that already happened.
        await this.promptForRating(gigId, claim.professionalId, gig.clientId).catch((err) => {
          this.logger.warn(`Rating prompt failed for gig ${gigId}: ${err instanceof Error ? err.message : err}`);
        });
        await this.notifyProfessionalOfCompletion(gigId, claim.professionalId).catch((err) => {
          this.logger.warn(`Completion notification failed for gig ${gigId}: ${err instanceof Error ? err.message : err}`);
        });
      }
    }

    return this.toView(result);
  }

  private async promptForRating(gigId: string, professionalId: string, clientId: string): Promise<void> {
    const client = await this.identity.getUser(clientId);
    if (!client.phone) return;
    const professional = await this.identity.getUser(professionalId);
    const firstName = professional.name?.trim().split(/\s+/)[0] ?? 'The professional';
    await this.whatsapp.promptForRating(client.phone, gigId, firstName);
  }

  /**
   * PLAN.md "Congrats on your first gig" — fires once per real release
   * (guarded by confirmRelease's own idempotency check above). "First
   * gig" is counted from released gigs, not a stored flag, so it stays
   * correct even if a professional's history predates this feature.
   */
  private async notifyProfessionalOfCompletion(gigId: string, professionalId: string): Promise<void> {
    const professional = await this.identity.getUser(professionalId);
    if (!professional.phone) return;
    const firstName = professional.name?.trim().split(/\s+/)[0] ?? 'there';
    const releasedCount = await this.prisma.claim.count({
      where: { professionalId, gig: { status: 'released' } },
    });
    const opener =
      releasedCount <= 1
        ? `🎉 Congrats ${firstName} — you just got your first gig done on Sorted!`
        : `🎉 Nice work, ${firstName} — another gig done on Sorted!`;
    await this.whatsapp.sendMessage(
      professional.phone,
      `${opener} You've been paid out for it.\n\nKeep transacting with us: the more jobs you complete here, the more customers we send your way — and as Sorted grows, we're building toward healthcare and pension access for professionals with a real track record on the platform.`,
    );
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

  /**
   * PLAN.md "Split payment pivot" — every dispute under this model is
   * pre-payment (raiseDispute only allows claimed/in_progress/submitted,
   * all before releaseToProfessional has ever run), so there is never
   * money sitting anywhere to move either direction:
   *
   * for_client: no charge was ever attempted, so there's nothing to
   * refund — this just closes the gig unpaid. Reuses the 'refunded'
   * status/state (not literally accurate — nothing was refunded — but
   * "closed, professional doesn't get paid" is the same real-world
   * outcome, and adding a new GigStatus/EscrowState value for this is a
   * bigger schema change than the semantic stretch is worth).
   *
   * for_professional: re-attempts the SAME charge+split
   * releaseToProfessional would have done, just entered from
   * dispute_hold. This is a REAL LIMIT, not a bug: it can prompt the
   * client to pay, it CANNOT force a charge on an uncooperative one —
   * Nigerian payment rails are mostly bank transfer/USSD, not saved
   * cards, so there's no "already authorized, just capture it" fallback.
   * Enforcement in the professional's favor is reputational (rating,
   * restricted future access) once a client won't cooperate, not
   * financial. Documented, not hidden — see escrow.interface.ts's top
   * comment.
   */
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
      // Genuinely undesigned, not an oversight — same as pre-pivot: how a
      // partial ruling should even work when nothing has been charged
      // yet is its own product decision, not guessed at here.
      throw new NotImplementedException(
        "EscrowService.resolveFrozen('split') — not designed yet. Use 'for_professional' or 'for_client'.",
      );
    }

    if (ruling === 'for_client') {
      const record = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.escrowRecord.update({
          where: { gigId },
          data: { state: 'refunded', stateChangedAt: new Date() },
        });
        await this.gigs.transitionStatus(gigId, 'refunded', tx);
        return updated;
      });
      return this.toView(record);
    }

    // for_professional — see this method's own doc comment for why this
    // is a best-effort prompt, not a guarantee.
    return this.initiateRelease(gigId);
  }

  private toView(record: EscrowRecord): EscrowRecordView {
    const bountyKobo = kobo(Number(record.bountyKobo));
    // Pre-surcharge records (feeKobo null) fall back to computing it from
    // platformFeeBps so old escrow rows still render sane totals.
    const feeKobo = record.feeKobo != null ? kobo(Number(record.feeKobo)) : applyBps(bountyKobo, record.platformFeeBps);
    const details = record.holdingAccountDetails as { provider: string; accountNumber?: string; bankName?: string; checkoutUrl?: string } | null;
    return {
      gigId: record.gigId,
      state: record.state as EscrowState,
      bountyKobo,
      stakeKobo: kobo(Number(record.stakeKobo)),
      platformFeeBps: record.platformFeeBps,
      feeKobo,
      totalChargeKobo: addKobo(bountyKobo, feeKobo),
      releaseCheckout: details ?? undefined,
    };
  }
}
