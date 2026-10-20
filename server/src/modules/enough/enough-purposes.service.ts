import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { PurposeSchedule, PurposeView, TrancheView } from './enough.interface';

/**
 * PLAN.md "Enough: landing spot + purposes" — not every deposit is salary
 * to auto-split (could be side income, a one-off transfer, anything), so
 * nothing is allocated automatically. Every deposit lands in
 * EnoughAccount.availableBalanceKobo (the "landing spot"); the user
 * explicitly pushes money from there into named purposes here. Purely
 * internal bookkeeping — never a separate Bachs account, never money
 * actually moving anywhere.
 *
 * PLAN.md "Enough: scheduled tranches" — a push into a purpose can
 * optionally specify a schedule (N tranches releasing every intervalDays),
 * locking part of that purpose's balance until each tranche's releaseAt
 * passes. Three decisions settled with the founder before building this:
 * (1) the schedule is set at push-time, not as a separate step, though
 * not-yet-released tranches can still be re-spaced afterward
 * (extendSchedule); (2) pushing MORE money into an already-scheduled
 * purpose starts its own independent tranche batch rather than merging
 * into the existing one; (3) early access is allowed, gated by the
 * transaction PIN (unlockTrancheEarly) rather than pretending the lock is
 * unbreakable — it isn't, this is a self-discipline tool, not a real
 * bank-enforced hold. "Locked" is informational only for now: there's no
 * spend-from-a-purpose action yet for it to actually block.
 */
@Injectable()
export class EnoughPurposesService {
  constructor(private readonly prisma: PrismaService) {}

  private async requireAccount(userId: string) {
    const account = await this.prisma.enoughAccount.findUnique({ where: { userId } });
    if (!account) throw new NotFoundException('Open your Enough account first.');
    return account;
  }

  private async requirePurpose(accountId: string, purposeId: string) {
    const purpose = await this.prisma.enoughPurpose.findUnique({ where: { id: purposeId } });
    if (!purpose || purpose.enoughAccountId !== accountId) throw new NotFoundException('Purpose not found.');
    return purpose;
  }

  private async lockedKoboByPurpose(purposeIds: string[]): Promise<Record<string, bigint>> {
    if (!purposeIds.length) return {};
    const rows = await this.prisma.enoughPurposeTranche.groupBy({
      by: ['purposeId'],
      where: { purposeId: { in: purposeIds }, releaseAt: { gt: new Date() }, releasedEarlyAt: null },
      _sum: { amountKobo: true },
    });
    const result: Record<string, bigint> = {};
    for (const row of rows) result[row.purposeId] = row._sum.amountKobo ?? BigInt(0);
    return result;
  }

  private toView(purpose: { id: string; name: string; balanceKobo: bigint; targetPercent: number | null }, lockedKobo: bigint): PurposeView {
    return {
      id: purpose.id,
      name: purpose.name,
      balanceKobo: purpose.balanceKobo.toString(),
      targetPercent: purpose.targetPercent,
      lockedKobo: lockedKobo.toString(),
    };
  }

  async listPurposes(userId: string): Promise<PurposeView[]> {
    const account = await this.requireAccount(userId);
    const purposes = await this.prisma.enoughPurpose.findMany({
      where: { enoughAccountId: account.id },
      orderBy: { createdAt: 'asc' },
    });
    const locked = await this.lockedKoboByPurpose(purposes.map((p) => p.id));
    return purposes.map((p) => this.toView(p, locked[p.id] ?? BigInt(0)));
  }

  async createPurpose(userId: string, name: string): Promise<PurposeView> {
    const account = await this.requireAccount(userId);
    const trimmed = name.trim();
    if (!trimmed) throw new BadRequestException('Purpose name cannot be empty.');
    try {
      const purpose = await this.prisma.enoughPurpose.create({
        data: { enoughAccountId: account.id, name: trimmed },
      });
      return this.toView(purpose, BigInt(0));
    } catch (err) {
      if (err instanceof Error && /Unique constraint/i.test(err.message)) {
        throw new ConflictException(`You already have a purpose named "${trimmed}".`);
      }
      throw err;
    }
  }

  /**
   * Moves amountKobo from the landing spot into this purpose. Guarded
   * atomically against both insufficient balance and a concurrent
   * allocation racing it — the balance check and the decrement happen in
   * the same conditional update, not as a separate read-then-write.
   *
   * `schedule`, when given, splits amountKobo into schedule.tranches
   * roughly-equal tranche rows (any remainder lands on the last one) —
   * the first releases immediately, each next one intervalDays after the
   * last, as its own independent batch (decision 2 above).
   */
  async allocate(userId: string, purposeId: string, amountKobo: bigint, schedule?: PurposeSchedule): Promise<{ purpose: PurposeView; availableBalanceKobo: string }> {
    const account = await this.requireAccount(userId);
    await this.requirePurpose(account.id, purposeId);

    if (schedule && (schedule.tranches < 1 || schedule.tranches > 90 || schedule.intervalDays < 1 || schedule.intervalDays > 90)) {
      throw new BadRequestException('Schedule must be 1-90 tranches, 1-90 days apart.');
    }

    const updatedPurpose = await this.prisma.$transaction(async (tx) => {
      const debited = await tx.enoughAccount.updateMany({
        where: { id: account.id, availableBalanceKobo: { gte: amountKobo } },
        data: { availableBalanceKobo: { decrement: amountKobo } },
      });
      if (debited.count === 0) {
        throw new BadRequestException('Not enough in your landing spot to push that much.');
      }
      // Recorded in the same transaction as the balance move — see
      // EnoughAccountsService.getHistory, the History tab's only source
      // for "where did this push go."
      await tx.enoughAllocationEvent.create({
        data: { enoughAccountId: account.id, purposeId, amountKobo },
      });

      if (schedule) {
        const perTranche = amountKobo / BigInt(schedule.tranches);
        const remainder = amountKobo - perTranche * BigInt(schedule.tranches);
        const now = Date.now();
        const tranches = Array.from({ length: schedule.tranches }, (_, i) => ({
          purposeId,
          amountKobo: i === schedule.tranches - 1 ? perTranche + remainder : perTranche,
          releaseAt: new Date(now + i * schedule.intervalDays * 24 * 60 * 60 * 1000),
        }));
        await tx.enoughPurposeTranche.createMany({ data: tranches });
      }

      return tx.enoughPurpose.update({
        where: { id: purposeId },
        data: { balanceKobo: { increment: amountKobo } },
      });
    });

    const refreshedAccount = await this.prisma.enoughAccount.findUniqueOrThrow({ where: { id: account.id } });
    const locked = await this.lockedKoboByPurpose([purposeId]);
    return {
      purpose: this.toView(updatedPurpose, locked[purposeId] ?? BigInt(0)),
      availableBalanceKobo: refreshedAccount.availableBalanceKobo.toString(),
    };
  }

  /** Called from EnoughPlanService.applyPlan — upserts a purpose's target share. Never moves money. */
  async upsertWithTarget(userId: string, name: string, targetPercent: number): Promise<PurposeView> {
    const account = await this.requireAccount(userId);
    const trimmed = name.trim();
    const purpose = await this.prisma.enoughPurpose.upsert({
      where: { enoughAccountId_name: { enoughAccountId: account.id, name: trimmed } },
      create: { enoughAccountId: account.id, name: trimmed, targetPercent },
      update: { targetPercent },
    });
    const locked = await this.lockedKoboByPurpose([purpose.id]);
    return this.toView(purpose, locked[purpose.id] ?? BigInt(0));
  }

  async listTranches(userId: string, purposeId: string): Promise<TrancheView[]> {
    const account = await this.requireAccount(userId);
    await this.requirePurpose(account.id, purposeId);
    const tranches = await this.prisma.enoughPurposeTranche.findMany({
      where: { purposeId },
      orderBy: { releaseAt: 'asc' },
    });
    const now = new Date();
    return tranches.map((t) => ({
      id: t.id,
      amountKobo: t.amountKobo.toString(),
      releaseAt: t.releaseAt.toISOString(),
      released: t.releasedEarlyAt !== null || t.releaseAt <= now,
      releasedEarly: t.releasedEarlyAt !== null,
    }));
  }

  /**
   * Decision 1: re-spaces only tranches that haven't released yet, leaving
   * already-released ones untouched — this stretches or compresses what's
   * left, it never retroactively re-locks money already available.
   */
  async extendSchedule(userId: string, purposeId: string, newIntervalDays: number): Promise<TrancheView[]> {
    if (newIntervalDays < 1 || newIntervalDays > 90) throw new BadRequestException('intervalDays must be 1-90.');
    const account = await this.requireAccount(userId);
    await this.requirePurpose(account.id, purposeId);

    const pending = await this.prisma.enoughPurposeTranche.findMany({
      where: { purposeId, releasedEarlyAt: null, releaseAt: { gt: new Date() } },
      orderBy: { releaseAt: 'asc' },
    });
    if (!pending.length) throw new BadRequestException('No pending tranches to reschedule.');

    const now = Date.now();
    await this.prisma.$transaction(
      pending.map((t, i) =>
        this.prisma.enoughPurposeTranche.update({
          where: { id: t.id },
          data: { releaseAt: new Date(now + (i + 1) * newIntervalDays * 24 * 60 * 60 * 1000) },
        }),
      ),
    );
    return this.listTranches(userId, purposeId);
  }

  /** Decision 3: early access is allowed, but PIN-gated — never silent. */
  async unlockTrancheEarly(userId: string, purposeId: string, trancheId: string, pin: string): Promise<TrancheView[]> {
    const account = await this.requireAccount(userId);
    await this.requirePurpose(account.id, purposeId);

    if (!account.transactionPinHash) {
      throw new BadRequestException('Set a transaction PIN first (Profile tab) before unlocking a tranche early.');
    }
    const matches = await bcrypt.compare(pin, account.transactionPinHash);
    if (!matches) throw new UnauthorizedException('Incorrect PIN.');

    const tranche = await this.prisma.enoughPurposeTranche.findUnique({ where: { id: trancheId } });
    if (!tranche || tranche.purposeId !== purposeId) throw new NotFoundException('Tranche not found.');

    await this.prisma.enoughPurposeTranche.update({
      where: { id: trancheId },
      data: { releasedEarlyAt: new Date() },
    });
    return this.listTranches(userId, purposeId);
  }
}
