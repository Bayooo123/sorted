import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../../common/auth/admin.guard';
import { AnalyticsService } from './analytics.service';

/**
 * Admin-only (x-admin-key) — one aggregated read for dashboard.html's
 * single page load. Same disclosed-manual admin pattern as KYC review and
 * the WhatsApp contacts dashboard. PLAN.md "Product analytics dashboard".
 */
@Controller('admin/analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @UseGuards(AdminGuard)
  @Get('overview')
  getOverview() {
    return this.analytics.getOverview();
  }
}
