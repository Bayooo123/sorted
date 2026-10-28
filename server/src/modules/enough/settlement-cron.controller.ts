import { Controller, Get, Headers, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SettlementSweepService } from './settlement-sweep.service';

/**
 * PLAN.md "Settlement sweep" — the endpoint server/vercel.json's `crons`
 * entry hits on a schedule. Same shape as DigestCronController: Vercel's
 * own cron infrastructure calls this directly (no admin/user session
 * involved), gated by the shared CRON_SECRET it attaches automatically as
 * `Authorization: Bearer ${CRON_SECRET}`. Does NOT soft-enforce — moving
 * real money is not something to leave reachable by anyone who finds the
 * URL.
 */
@Controller('cron')
export class SettlementCronController {
  private readonly logger = new Logger(SettlementCronController.name);

  constructor(
    private readonly sweep: SettlementSweepService,
    private readonly config: ConfigService,
  ) {}

  @Get('sweep-balances')
  async triggerSweep(@Headers('authorization') authorization?: string) {
    const secret = this.config.get<string>('CRON_SECRET');
    if (!secret || authorization !== `Bearer ${secret}`) {
      throw new UnauthorizedException('Missing or invalid cron authorization');
    }

    const result = await this.sweep.runSweep();
    this.logger.log(`Settlement sweep run: ${result.status}, ${result.amountKobo} kobo across ${result.accountsSwept} account(s)`);
    return result;
  }
}
