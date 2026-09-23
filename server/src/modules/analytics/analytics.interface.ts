import { GigStatus } from '@prisma/client';

export interface DayCount {
  date: string; // YYYY-MM-DD, UTC
  count: number;
}

export interface LabeledCount {
  label: string;
  count: number;
}

/**
 * PLAN.md "Product analytics dashboard" — one aggregated read for
 * dashboard.html's single page load. Every number here is derived from
 * data the product already writes (plus the two additions this feature
 * made: User.lastLoginAt and SiteEvent) — nothing is estimated or
 * fabricated. Where something genuinely isn't tracked yet (e.g. WhatsApp
 * broadcast accept/decline rate — declines aren't persisted anywhere
 * today), it's left out entirely rather than approximated.
 */
export interface AnalyticsOverview {
  generatedAt: string;
  accounts: {
    total: number;
    individualCount: number;
    businessCount: number;
    clientRoleCount: number;
    professionalRoleCount: number;
    activeLast7d: number;
    activeLast30d: number;
    newLast7d: number;
    newLast30d: number;
    signupsByDay: DayCount[];
    kyc: { unverified: number; pending: number; verified: number; rejected: number };
  };
  orders: {
    totalNonDraft: number;
    byStatus: Record<GigStatus, number>;
    activeCount: number;
    closedCount: number;
    disputedCount: number;
    gigsByDay: DayCount[];
    gmv: {
      postedKobo: number;
      fundedKobo: number;
      releasedKobo: number;
      refundedKobo: number;
      feeRevenueKobo: number;
    };
    byCategory: LabeledCount[];
    byState: LabeledCount[];
  };
  whatsapp: {
    totalContacts: number;
    registeredContacts: number;
    newLast7d: number;
    newLast30d: number;
    contactsByDay: DayCount[];
  };
  site: {
    pageviewsLast30d: number;
    pageviewsByDay: DayCount[];
    whatsappClicksLast30d: number;
    whatsappClicksByDay: DayCount[];
    whatsappClicksByCta: LabeledCount[];
    /** newSignupsLast30d / whatsappClicksLast30d — null if there were no clicks to divide by. */
    clickToSignupRatio: number | null;
    pageviewToSignupRatio: number | null;
  };
  disputes: {
    open: number;
    ruled: number;
    closed: number;
    total: number;
    ratePercentOfNonDraftGigs: number | null;
  };
  deliveryFailures: {
    failed: number;
    skippedOrFailedWithReason: number;
  };
  retention: {
    repeatClients: number;
    repeatProfessionals: number;
  };
}
