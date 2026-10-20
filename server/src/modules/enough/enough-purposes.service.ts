import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PurposeView } from './enough.interface';

/**
 * PLAN.md "Enough: landing spot + purposes" — not every deposit is salary
 * to auto-split (could be side income, a one-off transfer, anything), so
 * nothing is allocated automatically. Every deposit lands in
 * EnoughAccount.availableBalanceKobo (the "landing spot"); the user
 * explicitly pushes money from there into named purposes here. Purely
 * internal bookkeeping — never a separate Bachs account, never money
 * actually moving anywhere, so none of this needs the transfer-PIN step
 * that real money-movement-out (a future slice) will.
 */
@Injectable()
export class EnoughPurposesService {
  constructor(private readonly prisma: PrismaService) {}

  private toView(purpose: { id: string; name: string; balanceKobo: bigint; targetPercent: number | null }): PurposeView {
    return { id: purpose.id, name: purpose.name, balanceKobo: purpose.balanceKobo.toString(), targetPercent: purpose.targetPercent };
  }

  private async requireAccount(userId: string) {
    const account = await this.prisma.enoughAccount.findUnique({ where: { userId } });
    if (!account) throw new NotFoundException('Open your Enough account first.');
    return account;
  }

  async listPurposes(userId: string): Promise<PurposeView[]> {
    const account = await this.requireAccount(userId);
    const purposes = await this.prisma.enoughPurpose.findMany({
      where: { enoughAccountId: account.id },
      orderBy: { createdAt: 'asc' },
    });
    return purposes.map((p) => this.toView(p));
  }

  async createPurpose(userId: string, name: string): Promise<PurposeView> {
    const account = await this.requireAccount(userId);
    const trimmed = name.trim();
    if (!trimmed) throw new BadRequestException('Purpose name cannot be empty.');
    try {
      const purpose = await this.prisma.enoughPurpose.create({
        data: { enoughAccountId: account.id, name: trimmed },
      });
      return this.toView(purpose);
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
   */
  async allocate(userId: string, purposeId: string, amountKobo: bigint): Promise<{ purpose: PurposeView; availableBalanceKobo: string }> {
    const account = await this.requireAccount(userId);
    const purpose = await this.prisma.enoughPurpose.findUnique({ where: { id: purposeId } });
    if (!purpose || purpose.enoughAccountId !== account.id) {
      throw new NotFoundException('Purpose not found.');
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
      return tx.enoughPurpose.update({
        where: { id: purposeId },
        data: { balanceKobo: { increment: amountKobo } },
      });
    });

    const refreshedAccount = await this.prisma.enoughAccount.findUniqueOrThrow({ where: { id: account.id } });
    return { purpose: this.toView(updatedPurpose), availableBalanceKobo: refreshedAccount.availableBalanceKobo.toString() };
  }

  /**
   * Called from EnoughPlanService.applyPlan — creates a purpose with this
   * target if none exists under this name yet, otherwise just updates the
   * target on the existing one (balance untouched either way; applying a
   * plan never moves money, same as creating a purpose by hand never does).
   */
  async upsertWithTarget(userId: string, name: string, targetPercent: number): Promise<PurposeView> {
    const account = await this.requireAccount(userId);
    const trimmed = name.trim();
    const purpose = await this.prisma.enoughPurpose.upsert({
      where: { enoughAccountId_name: { enoughAccountId: account.id, name: trimmed } },
      create: { enoughAccountId: account.id, name: trimmed, targetPercent },
      update: { targetPercent },
    });
    return this.toView(purpose);
  }
}
