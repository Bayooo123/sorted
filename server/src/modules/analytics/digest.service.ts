import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { NOTIFICATIONS_PORT, NotificationsPort } from '../reputation-notifications/notifications.interface';

/**
 * PLAN.md "Daily founder briefing email" — computes the previous full UTC
 * calendar day's activity and emails it to every address in
 * FOUNDER_DIGEST_RECIPIENTS. Triggered by DigestCronController, which a
 * Vercel Cron job hits once a day (see server/vercel.json).
 *
 * Deliberately reuses the same Prisma tables AnalyticsService's 30-day
 * dashboard overview reads (Gig, EscrowRecord, SiteEvent, Dispute,
 * KycRequest, DeliveryTask, User) rather than inventing a parallel
 * aggregation path — the two just differ in time window and shape.
 */
@Injectable()
export class DigestService {
  private readonly logger = new Logger(DigestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(NOTIFICATIONS_PORT) private readonly notifications: NotificationsPort,
  ) {}

  /** Previous full UTC calendar day, [start, end). */
  private getYesterdayWindow(): { start: Date; end: Date; periodLabel: string } {
    const now = new Date();
    const todayUtcMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const start = new Date(todayUtcMidnight.getTime() - 24 * 60 * 60 * 1000);
    const end = todayUtcMidnight;
    const periodLabel = start.toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    return { start, end, periodLabel };
  }

  async sendDailyDigest(): Promise<{ sent: number; periodLabel: string }> {
    const recipients = (this.config.get<string>('FOUNDER_DIGEST_RECIPIENTS') || '')
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);

    if (recipients.length === 0) {
      this.logger.warn('FOUNDER_DIGEST_RECIPIENTS not set — skipping daily digest (nobody to send it to)');
      return { sent: 0, periodLabel: '' };
    }

    const { start, end, periodLabel } = this.getYesterdayWindow();
    const createdInWindow = { gte: start, lt: end };

    const [pageviews, whatsappClicks, newClientSignups, newProfessionalSignups, ordersPlacedAgg, releasedEscrows, disputesOpened, kycApplicationsSubmitted, deliveryFailures] =
      await Promise.all([
        this.prisma.siteEvent.count({ where: { type: 'pageview', createdAt: createdInWindow } }),
        this.prisma.siteEvent.count({ where: { type: 'whatsapp_click', createdAt: createdInWindow } }),
        this.prisma.user.count({ where: { createdAt: createdInWindow, roleFlags: { has: 'client' } } }),
        this.prisma.user.count({ where: { createdAt: createdInWindow, roleFlags: { has: 'professional' } } }),
        this.prisma.gig.aggregate({
          where: { status: { not: 'draft' }, createdAt: createdInWindow },
          _count: { _all: true },
          _sum: { bountyKobo: true },
        }),
        this.prisma.escrowRecord.findMany({
          where: { state: 'released', stateChangedAt: createdInWindow },
          select: { bountyKobo: true, feeKobo: true },
        }),
        this.prisma.dispute.count({ where: { createdAt: createdInWindow } }),
        this.prisma.kycRequest.count({ where: { createdAt: createdInWindow } }),
        this.prisma.deliveryTask.count({ where: { createdAt: createdInWindow, failureReason: { not: null } } }),
      ]);

    let transactionsCompletedValueKobo = 0;
    let feeRevenueKobo = 0;
    for (const r of releasedEscrows) {
      transactionsCompletedValueKobo += Number(r.bountyKobo) + Number(r.feeKobo ?? 0n);
      feeRevenueKobo += Number(r.feeKobo ?? 0n);
    }

    const event = {
      kind: 'founder_daily_digest' as const,
      periodLabel,
      pageviews,
      whatsappClicks,
      newClientSignups,
      newProfessionalSignups,
      ordersPlacedCount: ordersPlacedAgg._count._all,
      ordersPlacedValueKobo: Number(ordersPlacedAgg._sum.bountyKobo ?? 0n),
      transactionsCompletedCount: releasedEscrows.length,
      transactionsCompletedValueKobo,
      feeRevenueKobo,
      disputesOpened,
      kycApplicationsSubmitted,
      deliveryFailures,
    };

    // Sequential, not Promise.all — a Resend outage shouldn't spam retries
    // across every recipient at once, and this list is short (founders).
    let sent = 0;
    for (const email of recipients) {
      try {
        await this.notifications.notify({ userId: 'founder-digest', email }, event);
        sent++;
      } catch (err) {
        this.logger.warn(`Daily digest failed for ${email}: ${err instanceof Error ? err.message : err}`);
      }
    }

    return { sent, periodLabel };
  }
}
