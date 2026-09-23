import { Injectable } from '@nestjs/common';
import { GigStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsOverview, DayCount, LabeledCount } from './analytics.interface';

const DAY_MS = 24 * 60 * 60 * 1000;
const TREND_DAYS = 30;

const ACTIVE_GIG_STATUSES: GigStatus[] = ['open', 'claimed', 'in_progress', 'submitted', 'signed_off'];
const CLOSED_GIG_STATUSES: GigStatus[] = ['released', 'refunded', 'cancelled'];

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}

/** UTC calendar buckets, oldest first, zero-filled — so a quiet day shows as 0, not a gap. */
function bucketByDay(dates: Date[], days: number): DayCount[] {
  const buckets = new Map<string, number>();
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    buckets.set(d.toISOString().slice(0, 10), 0);
  }
  for (const date of dates) {
    const key = date.toISOString().slice(0, 10);
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return Array.from(buckets.entries()).map(([date, count]) => ({ date, count }));
}

function tallyBy<T>(rows: T[], keyOf: (row: T) => string | null | undefined): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function topN(counts: Map<string, number>, n: number): LabeledCount[] {
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([label, count]) => ({ label, count }));
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(): Promise<AnalyticsOverview> {
    const sevenDaysAgo = daysAgo(7);
    const thirtyDaysAgo = daysAgo(TREND_DAYS);

    const [accounts, orders, whatsapp, site, disputes, deliveryFailures, retention] = await Promise.all([
      this.getAccounts(sevenDaysAgo, thirtyDaysAgo),
      this.getOrders(thirtyDaysAgo),
      this.getWhatsapp(sevenDaysAgo, thirtyDaysAgo),
      this.getSite(thirtyDaysAgo),
      this.getDisputes(),
      this.getDeliveryFailures(),
      this.getRetention(),
    ]);

    // Cross-section ratios (site x accounts) computed here, after both are known.
    const newLast30d = accounts.newLast30d;
    const clickToSignupRatio = site.whatsappClicksLast30d > 0 ? newLast30d / site.whatsappClicksLast30d : null;
    const pageviewToSignupRatio = site.pageviewsLast30d > 0 ? newLast30d / site.pageviewsLast30d : null;

    // "Orders" for the dispute rate excludes drafts, same definition used everywhere else in this payload.
    const ratePercentOfNonDraftGigs = orders.totalNonDraft > 0 ? (disputes.total / orders.totalNonDraft) * 100 : null;

    return {
      generatedAt: new Date().toISOString(),
      accounts,
      orders,
      whatsapp,
      site: { ...site, clickToSignupRatio, pageviewToSignupRatio },
      disputes: { ...disputes, ratePercentOfNonDraftGigs },
      deliveryFailures,
      retention,
    };
  }

  private async getAccounts(sevenDaysAgo: Date, thirtyDaysAgo: Date): Promise<AnalyticsOverview['accounts']> {
    const [
      total,
      individualCount,
      businessCount,
      clientRoleCount,
      professionalRoleCount,
      activeLast7d,
      activeLast30d,
      newLast7d,
      newLast30d,
      signupRows,
      kycGroups,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { accountType: 'individual' } }),
      this.prisma.user.count({ where: { accountType: 'business' } }),
      this.prisma.user.count({ where: { roleFlags: { has: 'client' } } }),
      this.prisma.user.count({ where: { roleFlags: { has: 'professional' } } }),
      this.prisma.user.count({ where: { lastLoginAt: { gte: sevenDaysAgo } } }),
      this.prisma.user.count({ where: { lastLoginAt: { gte: thirtyDaysAgo } } }),
      this.prisma.user.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
      this.prisma.user.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      this.prisma.user.findMany({ where: { createdAt: { gte: thirtyDaysAgo } }, select: { createdAt: true } }),
      this.prisma.user.groupBy({ by: ['kycStatus'], _count: { _all: true } }),
    ]);

    const kyc = { unverified: 0, pending: 0, verified: 0, rejected: 0 };
    for (const g of kycGroups) kyc[g.kycStatus] = g._count._all;

    return {
      total,
      individualCount,
      businessCount,
      clientRoleCount,
      professionalRoleCount,
      activeLast7d,
      activeLast30d,
      newLast7d,
      newLast30d,
      signupsByDay: bucketByDay(
        signupRows.map((r) => r.createdAt),
        TREND_DAYS,
      ),
      kyc,
    };
  }

  private async getOrders(thirtyDaysAgo: Date): Promise<AnalyticsOverview['orders']> {
    const [statusGroups, gigsByDayRows, postedAgg, escrowRecords, submarketGroups, clientStateRows] = await Promise.all([
      this.prisma.gig.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.gig.findMany({
        where: { status: { not: 'draft' }, createdAt: { gte: thirtyDaysAgo } },
        select: { createdAt: true },
      }),
      this.prisma.gig.aggregate({ where: { status: { not: 'draft' } }, _sum: { bountyKobo: true } }),
      this.prisma.escrowRecord.findMany({
        select: { state: true, bountyKobo: true, feeKobo: true, professionalPayoutKobo: true },
      }),
      this.prisma.gig.groupBy({ by: ['submarketId'], where: { status: { not: 'draft' } }, _count: { _all: true } }),
      this.prisma.gig.findMany({
        where: { status: { not: 'draft' } },
        select: { client: { select: { state: true } } },
      }),
    ]);

    const byStatus = Object.fromEntries(
      ([
        'draft',
        'escrow_pending',
        'open',
        'claimed',
        'in_progress',
        'submitted',
        'signed_off',
        'disputed',
        'released',
        'refunded',
        'cancelled',
      ] as GigStatus[]).map((s) => [s, 0]),
    ) as Record<GigStatus, number>;
    for (const g of statusGroups) byStatus[g.status] = g._count._all;

    const totalNonDraft = Object.entries(byStatus).reduce((sum, [status, count]) => (status === 'draft' ? sum : sum + count), 0);
    const activeCount = ACTIVE_GIG_STATUSES.reduce((sum, s) => sum + byStatus[s], 0);
    const closedCount = CLOSED_GIG_STATUSES.reduce((sum, s) => sum + byStatus[s], 0);

    // Surcharge commission model (EscrowService/PLAN.md "Commission — interim
    // surcharge mechanism"): the client is charged bounty + fee, so "funded"
    // and "refunded" both use bounty+fee; "released" pays the professional
    // the full bounty, and feeKobo is realized revenue only once released
    // (a refund gives the fee back too).
    let fundedKobo = 0;
    let releasedKobo = 0;
    let refundedKobo = 0;
    let feeRevenueKobo = 0;
    for (const r of escrowRecords) {
      const totalCharged = Number(r.bountyKobo) + Number(r.feeKobo ?? 0n);
      if (r.state !== 'awaiting_funding') fundedKobo += totalCharged;
      if (r.state === 'released') {
        releasedKobo += Number(r.professionalPayoutKobo ?? 0n);
        feeRevenueKobo += Number(r.feeKobo ?? 0n);
      }
      if (r.state === 'refunded') refundedKobo += totalCharged;
    }

    const submarketIds = submarketGroups.map((g) => g.submarketId);
    const submarkets = submarketIds.length
      ? await this.prisma.submarket.findMany({ where: { id: { in: submarketIds } }, select: { id: true, label: true } })
      : [];
    const labelBySubmarketId = new Map(submarkets.map((s) => [s.id, s.label]));
    const byCategory = submarketGroups
      .map((g) => ({ label: labelBySubmarketId.get(g.submarketId) ?? 'Unknown', count: g._count._all }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const stateCounts = tallyBy(clientStateRows, (r) => r.client.state);
    const byState = topN(stateCounts, 10);

    return {
      totalNonDraft,
      byStatus,
      activeCount,
      closedCount,
      disputedCount: byStatus.disputed,
      gigsByDay: bucketByDay(
        gigsByDayRows.map((r) => r.createdAt),
        TREND_DAYS,
      ),
      gmv: {
        postedKobo: Number(postedAgg._sum.bountyKobo ?? 0n),
        fundedKobo,
        releasedKobo,
        refundedKobo,
        feeRevenueKobo,
      },
      byCategory,
      byState,
    };
  }

  private async getWhatsapp(sevenDaysAgo: Date, thirtyDaysAgo: Date): Promise<AnalyticsOverview['whatsapp']> {
    const [totalContacts, newLast7d, newLast30d, trendRows, allPhones] = await Promise.all([
      this.prisma.whatsAppSession.count(),
      this.prisma.whatsAppSession.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
      this.prisma.whatsAppSession.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      this.prisma.whatsAppSession.findMany({ where: { createdAt: { gte: thirtyDaysAgo } }, select: { createdAt: true } }),
      this.prisma.whatsAppSession.findMany({ select: { phone: true } }),
    ]);

    const registeredContacts = allPhones.length
      ? await this.prisma.user.count({ where: { phone: { in: allPhones.map((p) => p.phone) } } })
      : 0;

    return {
      totalContacts,
      registeredContacts,
      newLast7d,
      newLast30d,
      contactsByDay: bucketByDay(
        trendRows.map((r) => r.createdAt),
        TREND_DAYS,
      ),
    };
  }

  private async getSite(thirtyDaysAgo: Date): Promise<Omit<AnalyticsOverview['site'], 'clickToSignupRatio' | 'pageviewToSignupRatio'>> {
    const [pageviewRows, clickRows, ctaGroups] = await Promise.all([
      this.prisma.siteEvent.findMany({
        where: { type: 'pageview', createdAt: { gte: thirtyDaysAgo } },
        select: { createdAt: true },
      }),
      this.prisma.siteEvent.findMany({
        where: { type: 'whatsapp_click', createdAt: { gte: thirtyDaysAgo } },
        select: { createdAt: true },
      }),
      this.prisma.siteEvent.groupBy({
        by: ['ctaId'],
        where: { type: 'whatsapp_click', createdAt: { gte: thirtyDaysAgo } },
        _count: { _all: true },
      }),
    ]);

    return {
      pageviewsLast30d: pageviewRows.length,
      pageviewsByDay: bucketByDay(
        pageviewRows.map((r) => r.createdAt),
        TREND_DAYS,
      ),
      whatsappClicksLast30d: clickRows.length,
      whatsappClicksByDay: bucketByDay(
        clickRows.map((r) => r.createdAt),
        TREND_DAYS,
      ),
      whatsappClicksByCta: ctaGroups
        .map((g) => ({ label: g.ctaId ?? '(untagged)', count: g._count._all }))
        .sort((a, b) => b.count - a.count),
    };
  }

  private async getDisputes(): Promise<Omit<AnalyticsOverview['disputes'], 'ratePercentOfNonDraftGigs'>> {
    const groups = await this.prisma.dispute.groupBy({ by: ['status'], _count: { _all: true } });
    const byStatus = { open: 0, assigned: 0, ruled: 0, closed: 0 };
    for (const g of groups) byStatus[g.status] = g._count._all;
    const open = byStatus.open + byStatus.assigned;
    const total = open + byStatus.ruled + byStatus.closed;
    return { open, ruled: byStatus.ruled, closed: byStatus.closed, total };
  }

  private async getDeliveryFailures(): Promise<AnalyticsOverview['deliveryFailures']> {
    const [failed, skippedOrFailedWithReason] = await Promise.all([
      this.prisma.deliveryTask.count({ where: { status: 'failed' } }),
      this.prisma.deliveryTask.count({ where: { failureReason: { not: null } } }),
    ]);
    return { failed, skippedOrFailedWithReason };
  }

  private async getRetention(): Promise<AnalyticsOverview['retention']> {
    const [nonDraftGigClients, releasedClaims] = await Promise.all([
      this.prisma.gig.findMany({ where: { status: { not: 'draft' } }, select: { clientId: true } }),
      this.prisma.claim.findMany({ where: { gig: { status: 'released' } }, select: { professionalId: true } }),
    ]);

    const perClient = tallyBy(nonDraftGigClients, (g) => g.clientId);
    const perProfessional = tallyBy(releasedClaims, (c) => c.professionalId);

    return {
      repeatClients: Array.from(perClient.values()).filter((n) => n >= 2).length,
      repeatProfessionals: Array.from(perProfessional.values()).filter((n) => n >= 2).length,
    };
  }
}
