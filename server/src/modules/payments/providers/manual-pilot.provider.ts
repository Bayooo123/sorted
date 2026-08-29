import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { kobo } from '../../../common/money';
import {
  DisbursementResult,
  DisbursementSplit,
  FundingConfirmation,
  HoldingAccount,
  PaymentsProvider,
  RefundResult,
  WebhookVerificationResult,
} from '../payments.interface';

/**
 * PILOT ONLY — not Monnify. HANDOFF.md §3.4's SEAM in practice: "Monnify is
 * an implementation, not the interface... a second provider is a new class
 * behind the same interface." This is that second provider, added because
 * Monnify onboarding (business KYC) hasn't happened yet and gigs need a way
 * to actually get funded in the meantime.
 *
 * There is no real "rail" here — createHoldingAccount hands back one fixed
 * bank/Opay account (config, not a per-gig holding account — the same
 * account for every gig during the pilot). confirmFunding is triggered by
 * an admin action (EscrowController's confirm-funding route, gated by
 * ADMIN_API_KEY) once the founder sees the bank alert, not by any webhook
 * — there's nothing to verify against, only a human eyeballing their own
 * bank app. disburse/refund are no-ops that just record a reference; the
 * actual sending of money to a professional (or refund to a client) is a
 * manual transfer the founder does OUTSIDE the app, same as funding.
 *
 * This is a deliberate, disclosed stopgap, not a shortcut around Monnify —
 * the mobile/web copy calling this "manual pilot, not automated escrow" is
 * the actual safety mechanism here, not this code. Swap PAYMENTS_PROVIDER_KEY
 * to "monnify" once real Monnify credentials exist; nothing in EscrowService
 * or above needs to change (PaymentsModule's binding is the only thing that
 * flips) — that's the whole point of the interface being here.
 */
@Injectable()
export class ManualPilotProvider implements PaymentsProvider {
  private readonly logger = new Logger(ManualPilotProvider.name);
  readonly name = 'manual_pilot';

  constructor(private readonly config: ConfigService) {}

  async createHoldingAccount(gigId: string): Promise<HoldingAccount> {
    const accountNumber = this.config.get<string>('MANUAL_PILOT_ACCOUNT_NUMBER');
    const accountName = this.config.get<string>('MANUAL_PILOT_ACCOUNT_NAME');
    const bankName = this.config.get<string>('MANUAL_PILOT_BANK');
    if (!accountNumber || !accountName || !bankName) {
      throw new Error(
        'MANUAL_PILOT_ACCOUNT_NUMBER / MANUAL_PILOT_ACCOUNT_NAME / MANUAL_PILOT_BANK are not set — see server/.env.example',
      );
    }
    // holdingAccountRef carries the display name too (pipe-delimited) since
    // there's no per-gig account to look up later, unlike a real provider
    // where this ref would key a real API call.
    return {
      provider: this.name,
      holdingAccountRef: `${gigId}`,
      accountNumber,
      bankName: `${bankName} (${accountName})`,
    };
  }

  async confirmFunding(ref: string): Promise<FundingConfirmation> {
    // Not called by EscrowService.confirmFunding in the manual-pilot path —
    // there's nothing to verify an amount against (no provider API, just a
    // human reading their own bank alert). EscrowService uses the
    // EscrowRecord's own bountyKobo instead of trusting a provider-reported
    // amount, since this provider can't produce a trustworthy one.
    // Implemented for interface completeness only.
    return { ref, amountKobo: kobo(0), confirmedAt: new Date() };
  }

  async disburse(splits: DisbursementSplit[], idempotencyKey: string): Promise<DisbursementResult> {
    this.logger.warn(
      `MANUAL DISBURSEMENT NEEDED — no automated payout exists. Send these transfers by hand: ${JSON.stringify(splits)}`,
    );
    return { disbursementRef: idempotencyKey, idempotencyKey };
  }

  async refund(ref: string): Promise<RefundResult> {
    this.logger.warn(`MANUAL REFUND NEEDED — no automated refund exists for ref ${ref}. Send it by hand.`);
    return { refundRef: ref };
  }

  async verifyWebhook(): Promise<WebhookVerificationResult> {
    throw new Error('ManualPilotProvider has no webhooks — funding is confirmed by an admin action, not a callback.');
  }
}
