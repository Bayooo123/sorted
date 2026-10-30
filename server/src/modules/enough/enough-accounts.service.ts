import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { NOTIFICATIONS_PORT, NotificationsPort } from '../reputation-notifications/notifications.interface';
import { BACHS_CONNECT_ACCOUNT_PORT, BachsConnectAccountPort, EnoughAccountView, HistoryEntry, SubmitIdentityInput } from './enough.interface';
import { PagaConnectAccountProvider } from './providers/paga-connect-account.provider';
import { SettlementSweepService } from './settlement-sweep.service';

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
    private readonly config: ConfigService,
    @Inject(BACHS_CONNECT_ACCOUNT_PORT) private readonly bachs: BachsConnectAccountPort,
    @Inject(NOTIFICATIONS_PORT) private readonly notifications: NotificationsPort,
    // Injected directly (not via the switchable BACHS_CONNECT_ACCOUNT_PORT
    // token) — migrateToPaga below must always target Paga specifically,
    // regardless of what ENOUGH_PROVIDER_KEY currently points new signups
    // at, same reasoning as SettlementSweepService/EnoughPaymentsService
    // injecting concrete provider classes directly elsewhere.
    private readonly paga: PagaConnectAccountProvider,
    private readonly settlementSweep: SettlementSweepService,
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
    const bachsAccountId = await this.bachs.createAccount({
      contactEmail: user.email,
      displayName,
      firstName: input.firstName,
      lastName: input.lastName,
      bvn: input.bvn,
    });
    await this.bachs.submitRepresentative(bachsAccountId, input);

    // Sandbox activates virtual_accounts immediately on account creation
    // (Bachs' own docs, "Virtual accounts" guide, Connected account tab);
    // production won't be active yet here — capability.updated (handled
    // below) carries it the rest of the way. Checking once now, rather
    // than only ever waiting on the webhook, means sandbox testing (and
    // any dev environment without a reachable webhook endpoint yet) still
    // works end to end.
    const capability = await this.bachs.checkCapability(bachsAccountId);

    // PLAN.md "Settlement sweep" — stamps which rail this account's
    // deposits actually land on, read once here (not re-derived later —
    // switching ENOUGH_PROVIDER_KEY afterward must never silently change
    // which provider an EXISTING account's money is tracked against).
    // Paga is the default (unset, or anything other than 'bachs'/'nomba')
    // — see enough.module.ts's factories for why.
    const providerKey = this.config.get<string>('ENOUGH_PROVIDER_KEY');
    const provider = providerKey === 'bachs' || providerKey === 'nomba' ? providerKey : 'paga';

    const account = await this.prisma.enoughAccount.create({
      data: {
        userId,
        bachsAccountId,
        provider,
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

    const [deposits, allocations, payments] = await Promise.all([
      this.prisma.enoughDepositEvent.findMany({ where: { enoughAccountId: account.id } }),
      this.prisma.enoughAllocationEvent.findMany({ where: { enoughAccountId: account.id }, include: { purpose: true } }),
      this.prisma.enoughPaymentEvent.findMany({ where: { enoughAccountId: account.id } }),
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
      ...payments.map((p): HistoryEntry => ({
        id: p.id,
        type: 'payment',
        amountKobo: p.amountKobo.toString(),
        occurredAt: p.createdAt.toISOString(),
        paymentStatus: p.status as 'processing' | 'completed' | 'failed',
        recipientAccountName: p.recipientAccountName,
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

  /**
   * Called from the webhook handler on capability.updated for "transfers"
   * (recipient persona — see BachsPayoutProvider/BachsConnectAccountProvider's
   * own doc comments on the Make Payment self-transfer step). Confirmed with
   * Bachs support: an empty requirements list never means this capability
   * is active — only this webhook (or a live call) does, after their own
   * manual review finishes. Stores the status so it's visible without
   * guessing from payment failures, and emails the user the FIRST time it
   * flips to active (idempotent against a redelivered webhook, same
   * updateMany-on-the-old-value pattern EscrowService/ConflictException
   * uses elsewhere for a concurrent-write race, not just a redelivery one).
   */
  async handleTransfersCapabilityUpdated(bachsAccountId: string, status: string): Promise<void> {
    const account = await this.prisma.enoughAccount.findUnique({ where: { bachsAccountId }, include: { user: true } });
    if (!account) {
      this.logger.warn(`capability.updated (transfers) for unknown Bachs account ${bachsAccountId} — ignoring`);
      return;
    }

    const becameActive = status === 'active' && account.transfersCapabilityStatus !== 'active';
    const updated = await this.prisma.enoughAccount.updateMany({
      where: { id: account.id, transfersCapabilityStatus: account.transfersCapabilityStatus },
      data: { transfersCapabilityStatus: status as EnoughAccountView['status'] },
    });
    if (updated.count === 0) return; // Lost a race with another delivery of the same event — the other one already recorded this.

    if (becameActive && account.user.email) {
      // Awaited, not fire-and-forget — a dangling promise here can lose
      // the race against this serverless function's response being sent
      // and the execution context freezing, the same real bug confirmed
      // earlier today in EnoughPaymentsService's own capability self-heal.
      try {
        await this.notifications.notify({ userId: account.userId, email: account.user.email }, { kind: 'enough_transfers_enabled' });
      } catch (err) {
        this.logger.warn(`Enough transfers-enabled email failed for user ${account.userId}: ${err instanceof Error ? err.message : err}`);
      }
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

  /**
   * One-off, admin-triggered migration for an EXISTING account onto Paga
   * — see EnoughController's admin route. Not something ENOUGH_PROVIDER_KEY
   * or any webhook does automatically: a real user's deposit account
   * number is changing (their OLD Bachs/Nomba virtual account stops being
   * the one to send to), which needs telling them, not silently flipping.
   *
   * firstName/lastName/BVN aren't stored anywhere after the original
   * submitIdentity call (BVN deliberately isn't duplicated in our own DB
   * — see EnoughAccount.bachsAccountId's doc comment on Bachs/Nomba
   * holding identity data, not us). Re-derives firstName/lastName from
   * the stored displayName ("First Last — Enough") instead of asking the
   * user to resubmit anything — Paga's financialIdentificationNumber
   * (BVN) is OPTIONAL per its own docs (hashIndex-3, Required: False),
   * so this doesn't need the BVN at all.
   *
   * Runs a full settlement sweep FIRST, before touching this account's
   * `provider` column — SettlementSweepService's query is keyed off the
   * CURRENT provider value, so anything still sitting un-swept in this
   * account's old Bachs/Nomba sub-ledger would be silently orphaned
   * (invisible to every future sweep) if the column flipped to 'paga'
   * first. Safe to run anytime; a no-op if nothing's pending, and it
   * sweeps every other account too, not just this one — that's fine,
   * the whole point of the sweep is to keep every provider's balance
   * consolidated into Paga regardless of which account triggered it.
   */
  async migrateToPaga(userId: string): Promise<EnoughAccountView> {
    const account = await this.prisma.enoughAccount.findUnique({ where: { userId }, include: { user: true } });
    if (!account) throw new NotFoundException('No Enough account for this user.');
    if (account.provider === 'paga') throw new ConflictException('This account is already on Paga.');
    if (!account.user.email) throw new BadRequestException('This account has no email on file — cannot register a Paga persistent payment account.');

    const nameMatch = account.displayName.match(/^(\S+)\s+(.+?)\s*—\s*Enough\s*$/);
    const firstName = nameMatch?.[1] ?? account.displayName;
    const lastName = nameMatch?.[2] ?? '';

    const oldAccountNumber = account.virtualAccountNumber;
    const oldBankName = account.virtualAccountBankName;

    await this.settlementSweep.runSweep();

    const newAccountNumber = await this.paga.createAccount({
      contactEmail: account.user.email,
      displayName: account.displayName,
      firstName,
      lastName,
      bvn: '',
    });

    await this.prisma.enoughAccount.update({
      where: { id: account.id },
      data: {
        provider: 'paga',
        bachsAccountId: newAccountNumber,
        capabilityStatus: 'active',
        capabilityStatusDetail: null,
        virtualAccountId: newAccountNumber,
        virtualAccountNumber: newAccountNumber,
        virtualAccountBankName: 'Paga',
        virtualAccountBankCode: null,
      },
    });

    this.logger.log(`Migrated Enough account ${account.id} (user ${userId}) from ${account.provider} to Paga (new account ${newAccountNumber})`);

    // Critical, not fire-and-log — the whole point is the user finds out
    // their deposit account number changed before they (or whoever pays
    // them) sends money to the old one.
    try {
      await this.notifications.notify(
        { userId, email: account.user.email },
        {
          kind: 'enough_deposit_account_changed',
          oldAccountNumber,
          oldBankName,
          newAccountNumber,
          newBankName: 'Paga',
        },
      );
    } catch (err) {
      this.logger.error(
        `Deposit-account-changed email FAILED for user ${userId} after migrating to Paga (new account ${newAccountNumber}) — tell them manually: ${err instanceof Error ? err.message : err}`,
      );
    }

    return this.getAccountView(userId);
  }
}
