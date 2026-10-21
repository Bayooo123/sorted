import { BadRequestException, Inject, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { NOTIFICATIONS_PORT, NotificationsPort } from '../reputation-notifications/notifications.interface';
import {
  BACHS_CONNECT_ACCOUNT_PORT,
  BACHS_PAYOUT_PORT,
  BachsConnectAccountPort,
  BachsPayoutPort,
  BankOption,
  PaymentEventView,
  PaymentSource,
  ResolvedAccount,
  TransfersNotEnabledError,
} from './enough.interface';

/**
 * PLAN.md "Enough: Make Payment" — see BachsPayoutPort's doc comment for
 * the unverified-against-real-docs caveat. Debits the source (landing
 * spot, or a purpose's balance minus its locked tranches) atomically
 * alongside creating the EnoughPaymentEvent row, THEN calls Bachs — a
 * synchronous failure there credits the source back immediately; a
 * synchronous success leaves the row 'processing' for the payout webhook
 * to resolve. A webhook-reported failure also credits back, since the
 * money demonstrably never left.
 */
@Injectable()
export class EnoughPaymentsService {
  private readonly logger = new Logger(EnoughPaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(BACHS_PAYOUT_PORT) private readonly bachs: BachsPayoutPort,
    @Inject(BACHS_CONNECT_ACCOUNT_PORT) private readonly bachsConnect: BachsConnectAccountPort,
    @Inject(NOTIFICATIONS_PORT) private readonly notifications: NotificationsPort,
  ) {}

  private toView(p: {
    id: string;
    amountKobo: bigint;
    status: string;
    failureReason: string | null;
    recipientBankName: string | null;
    recipientBankCode: string;
    recipientAccountNumber: string;
    recipientAccountName: string;
    createdAt: Date;
  }): PaymentEventView {
    return {
      id: p.id,
      amountKobo: p.amountKobo.toString(),
      status: p.status as PaymentEventView['status'],
      failureReason: p.failureReason,
      recipientBankName: p.recipientBankName,
      recipientBankCode: p.recipientBankCode,
      recipientAccountNumber: p.recipientAccountNumber,
      recipientAccountName: p.recipientAccountName,
      createdAt: p.createdAt.toISOString(),
    };
  }

  private async requireAccount(userId: string) {
    const account = await this.prisma.enoughAccount.findUnique({ where: { userId }, include: { user: true } });
    if (!account) throw new NotFoundException('Open your Enough account first.');
    return account;
  }

  private async lockedKoboForPurpose(purposeId: string): Promise<bigint> {
    const agg = await this.prisma.enoughPurposeTranche.aggregate({
      where: { purposeId, releaseAt: { gt: new Date() }, releasedEarlyAt: null },
      _sum: { amountKobo: true },
    });
    return agg._sum.amountKobo ?? BigInt(0);
  }

  listBanks(): Promise<BankOption[]> {
    return this.bachs.listBanks();
  }

  async resolveAccount(userId: string, bankCode: string, accountNumber: string): Promise<ResolvedAccount> {
    await this.requireAccount(userId);
    return this.bachs.resolveAccount(bankCode, accountNumber);
  }

  async listPayments(userId: string): Promise<PaymentEventView[]> {
    const account = await this.requireAccount(userId);
    const payments = await this.prisma.enoughPaymentEvent.findMany({
      where: { enoughAccountId: account.id },
      orderBy: { createdAt: 'desc' },
    });
    return payments.map((p) => this.toView(p));
  }

  async initiatePayment(
    userId: string,
    source: PaymentSource,
    amountKobo: bigint,
    bankCode: string,
    accountNumber: string,
    pin: string,
  ): Promise<PaymentEventView> {
    const account = await this.requireAccount(userId);
    if (!account.user.email) throw new BadRequestException('Your Sorted account needs an email on file.');
    if (!account.transactionPinHash) throw new BadRequestException('Set a transaction PIN first (Profile tab).');
    const pinMatches = await bcrypt.compare(pin, account.transactionPinHash);
    if (!pinMatches) throw new UnauthorizedException('Incorrect PIN.');

    // Resolved server-side, authoritative — never trusts a client-supplied name.
    const resolved = await this.bachs.resolveAccount(bankCode, accountNumber);
    const bank = (await this.bachs.listBanks()).find((b) => b.code === bankCode);

    let purposeId: string | null = null;
    if (source.type === 'purpose') {
      const purpose = await this.prisma.enoughPurpose.findUnique({ where: { id: source.purposeId } });
      if (!purpose || purpose.enoughAccountId !== account.id) throw new NotFoundException('Purpose not found.');
      const locked = await this.lockedKoboForPurpose(purpose.id);
      const available = purpose.balanceKobo - locked;
      if (available < amountKobo) {
        throw new BadRequestException('Not enough unlocked money in that purpose to send that much.');
      }
      purposeId = purpose.id;
    }

    const paymentEvent = await this.prisma.$transaction(async (tx) => {
      if (purposeId) {
        const debited = await tx.enoughPurpose.updateMany({
          where: { id: purposeId, balanceKobo: { gte: amountKobo } },
          data: { balanceKobo: { decrement: amountKobo } },
        });
        // Belt-and-suspenders against a race between the lock check above and this update — see allocate()'s own comment on the same pattern.
        if (debited.count === 0) throw new BadRequestException('Not enough in that purpose to send that much.');
      } else {
        const debited = await tx.enoughAccount.updateMany({
          where: { id: account.id, availableBalanceKobo: { gte: amountKobo } },
          data: { availableBalanceKobo: { decrement: amountKobo } },
        });
        if (debited.count === 0) throw new BadRequestException('Not enough in your landing spot to send that much.');
      }

      return tx.enoughPaymentEvent.create({
        data: {
          enoughAccountId: account.id,
          sourcePurposeId: purposeId,
          amountKobo,
          recipientBankCode: bankCode,
          recipientBankName: bank?.name ?? null,
          recipientAccountNumber: accountNumber,
          recipientAccountName: resolved.accountName,
          status: 'processing',
        },
      });
    });

    try {
      const transferId = await this.bachs.pullToPlatform(account.bachsAccountId, amountKobo);
      const withdrawal = await this.bachs.createWithdrawal({
        bankCode,
        accountNumber,
        accountName: resolved.accountName,
        amountKobo,
        reference: paymentEvent.id,
        email: account.user.email,
      });
      const updated = await this.prisma.enoughPaymentEvent.update({
        where: { id: paymentEvent.id },
        data: { bachsTransferId: transferId, bachsWithdrawalId: withdrawal.withdrawalId },
      });
      return this.toView(updated);
    } catch (err) {
      // Synchronous failure — credit the source back and mark failed
      // immediately, rather than leaving money debited with nowhere to go.
      await this.creditBackAndMarkFailed(paymentEvent.id, account.id, purposeId, amountKobo, err instanceof Error ? err.message : 'Payment failed.');

      if (err instanceof TransfersNotEnabledError) {
        // Self-heal the REQUEST so a never-requested account doesn't stay
        // stuck forever — but confirmed with Bachs support (2026-10-21):
        // activating the capability itself needs a manual review pass on
        // their side, not just satisfying requirements, and the only
        // reliable signal that review has finished is a capability.updated
        // webhook (EnoughAccountsService.handleTransfersCapabilityUpdated),
        // not a quick retry. Repeating the request here is harmless —
        // Bachs treats a repeat "requested: true" as a no-op — but "try
        // again in a few seconds" was actively misleading and is gone.
        //
        // AWAITED, not fire-and-forget — confirmed live, 2026-10-20/21:
        // a dangling un-awaited promise here raced against this serverless
        // function's response being sent and Vercel freezing/killing the
        // execution context, so the request sometimes never completed at
        // all (no log, capability never actually requested). Awaiting adds
        // a little latency to this error response but guarantees the
        // request — and its diagnostic log — actually happens every time.
        try {
          await this.bachsConnect.requestTransfersCapability(account.bachsAccountId);
        } catch (reqErr) {
          this.logger.warn(`Failed to request transfers capability for ${account.bachsAccountId}: ${reqErr instanceof Error ? reqErr.message : reqErr}`);
        }
        throw new BadRequestException(
          "Bank transfers aren't turned on for your account yet — this needs a one-time review on our payments partner's side, which can take a while. We'll email you the moment it's ready.",
        );
      }

      throw new BadRequestException('Could not send that payment right now — your money has not left your account.');
    }
  }

  private async creditBackAndMarkFailed(
    paymentEventId: string,
    enoughAccountId: string,
    purposeId: string | null,
    amountKobo: bigint,
    reason: string,
  ): Promise<void> {
    await this.prisma.$transaction([
      purposeId
        ? this.prisma.enoughPurpose.update({ where: { id: purposeId }, data: { balanceKobo: { increment: amountKobo } } })
        : this.prisma.enoughAccount.update({ where: { id: enoughAccountId }, data: { availableBalanceKobo: { increment: amountKobo } } }),
      this.prisma.enoughPaymentEvent.update({ where: { id: paymentEventId }, data: { status: 'failed', failureReason: reason } }),
    ]);
  }

  /** Called from the payouts webhook controller on payout.paid / payout.failed. */
  async handlePayoutWebhook(withdrawalId: string, succeeded: boolean, failureReason: string | null): Promise<void> {
    const payment = await this.prisma.enoughPaymentEvent.findUnique({
      where: { bachsWithdrawalId: withdrawalId },
      include: { enoughAccount: { include: { user: true } } },
    });
    if (!payment) {
      this.logger.warn(`Payout webhook for unknown withdrawal ${withdrawalId} — ignoring`);
      return;
    }
    if (payment.status !== 'processing') {
      this.logger.log(`Payout webhook for ${withdrawalId} already resolved (${payment.status}) — ignoring redelivery`);
      return;
    }

    if (succeeded) {
      await this.prisma.enoughPaymentEvent.update({ where: { id: payment.id }, data: { status: 'completed' } });
    } else {
      await this.creditBackAndMarkFailed(
        payment.id,
        payment.enoughAccountId,
        payment.sourcePurposeId,
        payment.amountKobo,
        failureReason ?? 'Payment failed at the bank.',
      );
    }

    const email = payment.enoughAccount.user.email;
    if (email) {
      this.notifications
        .notify(
          { userId: payment.enoughAccount.userId, email },
          {
            kind: 'enough_payment_status_changed',
            completed: succeeded,
            amountKobo: Number(payment.amountKobo),
            recipientAccountName: payment.recipientAccountName,
            failureReason: succeeded ? null : failureReason ?? 'Payment failed at the bank.',
          },
        )
        .catch((err) => {
          this.logger.warn(`Payment status email failed for ${payment.id}: ${err instanceof Error ? err.message : err}`);
        });
    }
  }
}
