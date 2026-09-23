import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../../common/auth/admin.guard';
import { LeadsService } from './leads.service';
import { LeadStatus } from './leads.interface';
import { UpdateLeadStatusDto } from './dto/update-lead-status.dto';

/** Admin-only (x-admin-key) — same disclosed-manual pattern as every other admin surface. PLAN.md "WhatsApp intake: capture + human handoff". */
@Controller('admin/leads')
export class LeadsAdminController {
  constructor(private readonly leads: LeadsService) {}

  @UseGuards(AdminGuard)
  @Get()
  list(@Query('status') status?: LeadStatus) {
    return this.leads.listLeads(status);
  }

  @UseGuards(AdminGuard)
  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateLeadStatusDto) {
    return this.leads.updateStatus(id, dto.status);
  }
}
