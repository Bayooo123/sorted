import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { BachsPayoutPort } from './enough.interface';
import { BachsPayoutProvider } from './providers/bachs-payout.provider';
import { PagaPayoutProvider } from './providers/paga-payout.provider';

export interface SweepResult {
  amountKobo: string;
  accountsSwept: number;
  status: 'completed' | 'failed' | 'skipped';
  failureReason: string | null;
}

/**
 * PLAN.md "Settlement sweep" — the piece that actually answers "the total
 * across the whole product is ₦300k but only ₦100k of it is sitting in
 * Nomba, how do we send ₦200k": physically moves money collected on a
 * secondary provider (Bachs, or Paga) over to the one designated settlement
 * provider (Nomba) that EnoughPaymentsService.initiatePayment always pays
 * out through — see SETTLEMENT_PAYOUT_PORT's doc comment.
 *
 * Deliberately does NOT touch EnoughAccount.availableBalanceKobo anywhere
 * in this file. A sweep only changes WHERE the cash physically sits, not
 * who's entitled to it — that ledger is already correct the moment a
 * deposit webhook lands, regardless of which bank is holding the money.
 *
 * Loops over every SECONDARY provider directly (bachs, paga — never
 * nomba, which is the destination, not a source), injecting each
 * concrete payout-provider class directly rather than through the
 * switchable BACHS_PAYOUT_PORT token — same reasoning as before Paga
 * existed: a sweep must always be able to reach EVERY provider that
 * might hold collected-but-unswept funds, regardless of which one
 * ENOUGH_PROVIDER_KEY currently points new signups at.
 *
 * Two-step per secondary provider, mirroring exactly what a real user
 * payout already does against that provider (EnoughPaymentsService used
 * to call these same two methods directly before the settlement-port
 * split): pullToPlatform moves each account's own sub-ledger balance up
 * to that provider's PLATFORM balance (a no-op for Paga and Nomba, which
 * have no per-user sub-ledger — see each provider's own doc comment);
 * createWithdrawal then moves the platform balance's aggregate total out
 * to Nomba's one designated settlement virtual account. If the second
 * step fails after the first succeeded, the money sits at the secondary
 * provider's platform level until the next sweep run retries the
 * withdrawal — safe (no double-pull risk, since a pulled sub-account's
 * balance already reads as spent at the provider's end) but not
 * self-healing beyond "try again next run"; a provider that keeps
 * failing here needs a human to look at it, not a cleverer retry loop.
 */
@Injectable()
export class SettlementSweepService {
  private readonly logger = new Logger(SettlementSweepService.name);
  private readonly secondaryProviders: Array<{ key: string; port: BachsPayoutPort }>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    bachs: BachsPayoutProvider,
    paga: PagaPayoutProvider,
  ) {
    this.secondaryProviders = [
      { key: 'bachs', port: bachs },
      { key: 'paga', port: paga },
    ];
  }

  async runSweep(): Promise<SweepResult> {
    const accountNumber = this.config.get<string>('NOMBA_SETTLEMENT_ACCOUNT_NUMBER');
    const bankCode = this.config.get<string>('NOMBA_SETTLEMENT_BANK_CODE');
    const accountName = this.config.get<string>('NOMBA_SETTLEMENT_ACCOUNT_NAME');
    const notifyEmail = this.config.get<string>('SETTLEMENT_NOTIFICATION_EMAIL');
    if (!accountNumber || !bankCode || !accountName || !notifyEmail) {
      this.logger.warn(
        'Settlement sweep skipped — missing NOMBA_SETTLEMENT_ACCOUNT_NUMBER/NOMBA_SETTLEMENT_BANK_CODE/NOMBA_SETTLEMENT_ACCOUNT_NAME/SETTLEMENT_NOTIFICATION_EMAIL',
      );
      return { amountKobo: '0', accountsSwept: 0, status: 'skipped', failureReason: 'Settlement destination not configured' };
    }

    let grandTotalPulled = BigInt(0);
    let grandAccountsSwept = 0;
    let anyFailure: string | null = null;

    for (const { key, port } of this.secondaryProviders) {
      const candidates = await this.prisma.enoughAccount.findMany({
        where: { provider: key, availableBalanceKobo: { gt: BigInt(0) } },
        select: { id: true, bachsAccountId: true, availableBalanceKobo: true },
      });

      let totalPulled = BigInt(0);
      let accountsSwept = 0;
      for (const account of candidates) {
        try {
          await port.pullToPlatform(account.bachsAccountId, account.availableBalanceKobo);
          totalPulled += account.availableBalanceKobo;
          accountsSwept += 1;
        } catch (err) {
          this.logger.warn(`Sweep: pull failed for ${key} account ${account.bachsAccountId}: ${err instanceof Error ? err.message : err}`);
        }
      }

      if (totalPulled === BigInt(0)) continue;

      try {
        await port.createWithdrawal({
          bankCode,
          accountNumber,
          accountName,
          amountKobo: totalPulled,
          reference: `sweep_${key}_${Date.now()}`,
          email: notifyEmail,
        });
        await this.prisma.settlementSweep.create({
          data: { fromProvider: key, toProvider: 'nomba', amountKobo: totalPulled, accountsSwept, status: 'completed' },
        });
        this.logger.log(`Settlement sweep completed: ${totalPulled} kobo from ${accountsSwept} ${key} account(s) moved to Nomba settlement account`);
        grandTotalPulled += totalPulled;
        grandAccountsSwept += accountsSwept;
      } catch (err) {
        const failureReason = err instanceof Error ? err.message : 'Sweep withdrawal failed';
        await this.prisma.settlementSweep.create({
          data: { fromProvider: key, toProvider: 'nomba', amountKobo: totalPulled, accountsSwept, status: 'failed', failureReason },
        });
        this.logger.error(
          `Settlement sweep: withdrawal to Nomba settlement account failed after pulling ${totalPulled} kobo from ${accountsSwept} ${key} account(s): ${failureReason}`,
        );
        grandTotalPulled += totalPulled;
        grandAccountsSwept += accountsSwept;
        anyFailure = failureReason;
      }
    }

    return {
      amountKobo: grandTotalPulled.toString(),
      accountsSwept: grandAccountsSwept,
      status: anyFailure ? 'failed' : 'completed',
      failureReason: anyFailure,
    };
  }
}
