import { Injectable, NotImplementedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
 * v1 PaymentsProvider (HANDOFF.md §3.4, §5). This file is the ONLY place in
 * the codebase permitted to talk to Monnify (via its SDK/MCP server or REST
 * API) — see §9 checklist. Skeleton only: slice 4 implements
 * createHoldingAccount/confirmFunding (Reserved Account), slice 7 implements
 * disburse (with incomeSplitConfig for the fee split) and refund.
 *
 * This is a money slice — HANDOFF.md §7 marks slice 4 and slice 7 "first
 * money slice — supervise" / "Supervise." Do not implement webhook handling
 * without IP-allowlist + signature verification + idempotency on event_id
 * (§5, §9) all present in the same change.
 */
@Injectable()
export class MonnifyProvider implements PaymentsProvider {
  readonly name = 'monnify';

  constructor(private readonly config: ConfigService) {}

  createHoldingAccount(_gigId: string): Promise<HoldingAccount> {
    throw new NotImplementedException('MonnifyProvider.createHoldingAccount — slice 4');
  }

  confirmFunding(_ref: string): Promise<FundingConfirmation> {
    throw new NotImplementedException('MonnifyProvider.confirmFunding — slice 4');
  }

  disburse(_splits: DisbursementSplit[], _idempotencyKey: string): Promise<DisbursementResult> {
    throw new NotImplementedException('MonnifyProvider.disburse — slice 7');
  }

  refund(_ref: string): Promise<RefundResult> {
    throw new NotImplementedException('MonnifyProvider.refund — slice 8 (disputes: for_client ruling)');
  }

  verifyWebhook(
    _payload: unknown,
    _headers: Record<string, string>,
  ): Promise<WebhookVerificationResult> {
    throw new NotImplementedException('MonnifyProvider.verifyWebhook — slice 4');
  }
}
