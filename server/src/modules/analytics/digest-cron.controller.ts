import { Controller, Get, Headers, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DigestService } from './digest.service';

/**
 * PLAN.md "Daily founder briefing email" — the endpoint server/vercel.json's
 * `crons` entry hits once a day. Not an admin route (no x-admin-key/JWT
 * session involved — Vercel's own cron infrastructure calls this directly),
 * so it's gated by its own shared secret instead of AdminGuard.
 *
 * Vercel attaches `Authorization: Bearer ${CRON_SECRET}` automatically to
 * cron-triggered requests when that env var is set on the project — this
 * just checks it matches. CRON_SECRET unset -> reject everything: a daily
 * digest sent to founders is cheap to abuse (anyone who finds the URL could
 * otherwise trigger emails on demand), so unlike most optional secrets in
 * this codebase, this one does NOT soft-enforce.
 */
@Controller('cron')
export class DigestCronController {
  private readonly logger = new Logger(DigestCronController.name);

  constructor(
    private readonly digest: DigestService,
    private readonly config: ConfigService,
  ) {}

  @Get('daily-digest')
  async triggerDailyDigest(@Headers('authorization') authorization?: string) {
    const secret = this.config.get<string>('CRON_SECRET');
    if (!secret || authorization !== `Bearer ${secret}`) {
      throw new UnauthorizedException('Missing or invalid cron authorization');
    }

    const result = await this.digest.sendDailyDigest();
    this.logger.log(`Daily digest run for ${result.periodLabel || '(no recipients configured)'}: sent to ${result.sent} recipient(s)`);
    return result;
  }
}
