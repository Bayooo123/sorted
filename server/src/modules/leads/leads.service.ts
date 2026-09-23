import { Injectable } from '@nestjs/common';
import { Lead } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CaptureLeadInput, LeadStatus, LeadView } from './leads.interface';

/**
 * PLAN.md "WhatsApp intake: capture + human handoff" — owns the pre-sales
 * Lead record captured by WhatsappGigConversationService. Deliberately thin:
 * this is a capture-and-list service, not a workflow engine — status moves
 * forward by hand (an admin marks it contacted/converted/closed), there's
 * no automation deciding when a lead is "done."
 */
@Injectable()
export class LeadsService {
  constructor(private readonly prisma: PrismaService) {}

  async captureLead(input: CaptureLeadInput): Promise<LeadView> {
    const lead = await this.prisma.lead.create({
      data: {
        phone: input.phone,
        waProfileName: input.waProfileName ?? null,
        message: input.message,
        submarketGuess: input.submarketGuess ?? null,
      },
    });
    return this.toView(lead);
  }

  /** Newest first, capped at 500 — same reasoning as the WhatsApp contacts dashboard. */
  async listLeads(status?: LeadStatus): Promise<LeadView[]> {
    const leads = await this.prisma.lead.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return this.resolveLabels(leads);
  }

  async updateStatus(id: string, status: LeadStatus): Promise<LeadView> {
    const lead = await this.prisma.lead.update({ where: { id }, data: { status } });
    return this.toView(lead);
  }

  private async resolveLabels(leads: Lead[]): Promise<LeadView[]> {
    const keys = [...new Set(leads.map((l) => l.submarketGuess).filter((k): k is string => !!k))];
    const submarkets = keys.length ? await this.prisma.submarket.findMany({ where: { key: { in: keys } } }) : [];
    const labelByKey = new Map(submarkets.map((s) => [s.key, s.label]));
    return leads.map((l) => ({ ...this.toView(l), submarketLabel: l.submarketGuess ? (labelByKey.get(l.submarketGuess) ?? null) : null }));
  }

  private toView(lead: Lead): LeadView {
    return {
      id: lead.id,
      phone: lead.phone,
      waProfileName: lead.waProfileName,
      message: lead.message,
      submarketGuess: lead.submarketGuess,
      submarketLabel: null,
      status: lead.status as LeadStatus,
      createdAt: lead.createdAt,
      updatedAt: lead.updatedAt,
    };
  }
}
