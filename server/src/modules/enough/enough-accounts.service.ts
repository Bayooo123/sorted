import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { NOTIFICATIONS_PORT, NotificationsPort } from '../reputation-notifications/notifications.interface';
import { BACHS_CONNECT_ACCOUNT_PORT, BachsConnectAccountPort, EnoughAccountView, HistoryEntry, SubmitIdentityInput } from './enough.interface';

// Same rounds as IdentityService's own BCRYPT_ROUNDS — not imported, same
// reasoning as that constant being module-local rather than shared.
const BCRYPT_ROUNDS = 12;

/**
 * PLAN.md "Enough: Bachs Connect account per signup". Orchestrates Bachs
 * Connect calls + this module's own tables — BachsConnectAccountProvider
 * never touches Prisma, this service never calls fetch directly, same
 * split as every other PaymentsProvider/EscrowService pairing.
 */
@Injectable()
export class EnoughAccountsService {
  private readonly logger = new Logger(EnoughAccountsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(BACHS_CONNECT_ACCOUNT_PORT) private readonly bachs: BachsConnectAccountPort,
    @Inject(NOTIFICATIONS_PORT) private readonly notifications: NotificationsPort,
  ) {}

  /**
   * The actual identity-verification step — first+last name and BVN go
   * to Bachs in the SAME call that creates the account (Bachs calls this
   * the account's "representative"), not a separate verification pass.
   * One-time: a second call for a user who already has an EnoughAccount
   * is rejected rather than silently creating a duplicate Bachs account.
   */
  async submitIdentity(userId: string, input: SubmitIdentityInput): Promise<EnoughAccountView> {
    const existing = await this.prisma.enoughAccount.findUnique({ where: { userId } });
    if (existing) {
      throw new ConflictException('An Enough account already exists for this user.');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.email) {
      throw new BadRequestException('Your Sorted account needs an email on file before creating an Enough account.');
    }

    if (!/^\d{11}$/.test(input.bvn)) {
      throw new BadRequestException('BVN must be exactly 11 digits.');
    }

    const displayName = `${input.firstName} ${input.lastName} — Enough`;
    const bachsAccountId = await this.bachs.createAccount({ contactEmail: user.email, displayName });
    await this.bachs.submitRepresentative(bachsAccountId, input);

    // Sandbox activates virtual_accounts immediately on account creation
    // (Bachs' own docs, "Virtual accounts" guide, Connected account tab);
    // production won't be active yet here — capability.updated (handled
    // below) carries it the rest of the way. Checking once now, rather
    // than only ever waiting on the webhook, means sandbox testing (and
    // any dev environment without a reachable webhook endpoint yet) still
    // works end to end.
    const capability = await this.bachs.checkCapability(bachsAccountId);

    const account = await this.prisma.enoughAccount.create({
      data: {
        userId,
        bachsAccountId,
        displayName,
        capabilityStatus: capability.status,
        capabilityStatusDetail: capability.detail,
      },
    });

    // Fire-and-log, not fire-and-fail — same discipline as
    // IdentityService.signup's own welcome email: a Resend outage shouldn't
    // fail the BVN submission that already succeeded with Bachs.
    this.notifications
      .notify({ userId, email: user.email }, { kind: 'enough_account_opened', name: input.firstName })
      .catch((err) => {
        this.logger.warn(`Enough welcome email failed for user ${userId}: ${err instanceof Error ? err.message : err}`);
      });

    if (capability.status === 'active') {
      await this.activateVirtualAccount(account.id, bachsAccountId);
    }

    return this.getAccountView(userId);
  }

  async getAccountView(userId: string): Promise<EnoughAccountView> {
    let account = await this.prisma.enoughAccount.findUnique({ where: { userId } });
    if (!account) {
      return {
        status: 'unrequested',
        statusDetail: null,
        accountName: null,
        virtualAccountNumber: null,
        bankName: null,
        bankCode: null,
        availableBalanceKobo: '0',
        hasTransactionPin: false,
        description: null,
      };
    }

    // Self-healing: capability.updated already flipped this to active, but
    // activateVirtualAccount's own ensureVirtualAccount call didn't land
    // (e.g. a transient Bachs error, or the bank_code shape bug fixed
    // alongside this) — retry on read rather than wait on a webhook
    // redelivery that may never come, since the capability itself is
    // already confirmed active.
    if (account.capabilityStatus === 'active' && !account.virtualAccountNumber) {
      await this.activateVirtualAccount(account.id, account.bachsAccountId);
      account = await this.prisma.enoughAccount.findUnique({ where: { userId } });
    }

    return {
      status: account!.capabilityStatus,
      statusDetail: account!.capabilityStatusDetail,
      accountName: account!.displayName,
      virtualAccountNumber: account!.virtualAccountNumber,
      bankName: account!.virtualAccountBankName,
      bankCode: account!.virtualAccountBankCode,
      availableBalanceKobo: account!.availableBalanceKobo.toString(),
      hasTransactionPin: !!account!.transactionPinHash,
      description: account!.description,
    };
  }

  /** Saves the free-text "describe yourself" input to EnoughPlanService.generatePlan. */
  async updateDescription(userId: string, description: string): Promise<void> {
    const account = await this.prisma.enoughAccount.findUnique({ where: { userId } });
    if (!account) throw new NotFoundException('Open your Enough account first.');
    await this.prisma.enoughAccount.update({ where: { id: account.id }, data: { description } });
  }

  /**
   * First-time setup (currentPin omitted) or a change (currentPin
   * required and checked). Gates money-movement-OUT actions once those
   * exist — setting it up doesn't need one itself, since nothing it
   * would protect can be done yet.
   */
  async setTransactionPin(userId: string, newPin: string, currentPin?: string): Promise<void> {
    const account = await this.prisma.enoughAccount.findUnique({ where: { userId } });
    if (!account) throw new NotFoundException('Open your Enough account first.');

    if (account.transactionPinHash) {
      if (!currentPin) throw new BadRequestException('currentPin is required to change an existing PIN.');
      const matches = await bcrypt.compare(currentPin, account.transactionPinHash);
      if (!matches) throw new UnauthorizedException('Current PIN is incorrect.');
    }

    const transactionPinHash = await bcrypt.hash(newPin, BCRYPT_ROUNDS);
    await this.prisma.enoughAccount.update({ where: { id: account.id }, data: { transactionPinHash } });
  }

  /**
   * PLAN.md "Enough: History tab" — the only two ways money moves in this
   * module so far: a deposit lands in the landing spot, or it gets pushed
   * from there into a purpose. Merged and sorted newest-first; a third
   * event kind (real money-movement-out) joins this feed once built.
   */
  async getHistory(userId: string): Promise<HistoryEntry[]> {
    const account = await this.prisma.enoughAccount.findUnique({ where: { userId } });
    if (!account) return [];

    const [deposits, allocations] = await Promise.all([
      this.prisma.enoughDepositEvent.findMany({ where: { enoughAccountId: account.id } }),
      this.prisma.enoughAllocationEvent.findMany({ where: { enoughAccountId: account.id }, include: { purpose: true } }),
    ]);

    const entries: HistoryEntry[] = [
      ...deposits.map((d): HistoryEntry => ({
        id: d.id,
        type: 'deposit',
        amountKobo: d.amountKobo.toString(),
        occurredAt: d.receivedAt.toISOString(),
      })),
      ...allocations.map((a): HistoryEntry => ({
        id: a.id,
        type: 'allocation',
        amountKobo: a.amountKobo.toString(),
        occurredAt: a.createdAt.toISOString(),
        purposeName: a.purpose.name,
      })),
    ];

    entries.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    return entries;
  }

  /** Called from the webhook handler on account.updated/capability.updated. */
  async handleCapabilityUpdated(bachsAccountId: string, status: string, detail: string | null): Promise<void> {
    const account = await this.prisma.enoughAccount.findUnique({ where: { bachsAccountId } });
    if (!account) {
      this.logger.warn(`capability.updated for unknown Bachs account ${bachsAccountId} — ignoring`);
      return;
    }
    await this.prisma.enoughAccount.update({
      where: { id: account.id },
      data: { capabilityStatus: status as EnoughAccountView['status'], capabilityStatusDetail: detail },
    });
    if (status === 'active' && !account.virtualAccountNumber) {
      await this.activateVirtualAccount(account.id, bachsAccountId);
    }
  }

  private async activateVirtualAccount(enoughAccountId: string, bachsAccountId: string): Promise<void> {
    const virtualAccount = await this.bachs.ensureVirtualAccount(bachsAccountId);
    if (!virtualAccount) return; // Logged by the provider already — not active yet, webhook will retry this path later.
    await this.prisma.enoughAccount.update({
      where: { id: enoughAccountId },
      data: {
        virtualAccountId: virtualAccount.id,
        virtualAccountNumber: virtualAccount.accountNumber,
        virtualAccountBankName: virtualAccount.bankName,
        virtualAccountBankCode: virtualAccount.bankCode,
      },
    });
  }

  /**
   * collection.succeeded for a deposit (checkout_id null) — idempotent on
   * Bachs' own event id, same discipline as LedgerEntry.eventId. amountKobo
   * is the SETTLEMENT amount (after Bachs' processing fee), matching what
   * actually lands in the account's usable balance.
   */
  async handleDeposit(eventId: string, bachsAccountId: string, chargeId: string, amountKobo: bigint): Promise<void> {
    const account = await this.prisma.enoughAccount.findUnique({ where: { bachsAccountId }, include: { user: true } });
    if (!account) {
      this.logger.warn(`collection.succeeded for unknown Bachs account ${bachsAccountId} — ignoring`);
      return;
    }
    let updated;
    try {
      [, updated] = await this.prisma.$transaction([
        this.prisma.enoughDepositEvent.create({ data: { id: eventId, enoughAccountId: account.id, chargeId, amountKobo } }),
        this.prisma.enoughAccount.update({
          where: { id: account.id },
          data: { availableBalanceKobo: { increment: amountKobo } },
        }),
      ]);
    } catch (err) {
      // Unique-constraint failure on eventId = a redelivered webhook —
      // exactly the idempotency this id-as-primary-key is for, not a real
      // error (and not a reason to re-send the email below). Anything else
      // rethrows.
      if (!(err instanceof Error) || !/Unique constraint/i.test(err.message)) throw err;
      this.logger.log(`Deposit event ${eventId} already recorded — ignoring redelivery`);
      return;
    }

    // Fire-and-log, not fire-and-fail — same discipline as the welcome
    // email above: a Resend outage shouldn't fail a deposit that already
    // landed.
    if (account.user.email) {
      this.notifications
        .notify(
          { userId: account.userId, email: account.user.email },
          { kind: 'enough_deposit_received', amountKobo: Number(amountKobo), availableBalanceKobo: updated.availableBalanceKobo.toString() },
        )
        .catch((err) => {
          this.logger.warn(`Enough deposit email failed for user ${account.userId}: ${err instanceof Error ? err.message : err}`);
        });
    }
  }
}
