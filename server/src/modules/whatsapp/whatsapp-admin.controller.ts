import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../../common/auth/admin.guard';
import { PrismaService } from '../../prisma/prisma.service';

export interface WhatsAppContactView {
  phone: string;
  /** Meta's `contacts[0].profile.name` — not verified, just whatever WhatsApp reports. */
  waProfileName: string | null;
  conversationState: string;
  createdAt: Date;
  lastInboundAt: Date;
  /** null if this phone never became (or isn't linked to) a registered Sorted account. */
  registeredUser: { id: string; name: string | null; roles: string[] } | null;
}

/**
 * Admin-only (x-admin-key). "Who's messaging the WhatsApp bot" — the
 * whole point of PLAN.md "WhatsApp contacts dashboard": once the bot's
 * number is the contact number on a flier, this is the only visibility
 * into who actually reached out, registered or not. Same disclosed-
 * manual admin pattern as KYC review (AdminGuard, no dedicated admin
 * User model) — reviewed from a separate, unlinked page
 * (whatsapp-admin.html), same as kyc-admin.html.
 *
 * Lives in WhatsappModule (not WhatsappWebhookModule) since it only
 * needs the global PrismaService, not IdentityService — see
 * whatsapp.interface.ts's doc comment for why WhatsappModule stays
 * IdentityModule-free.
 */
@Controller('admin/whatsapp')
export class WhatsappAdminController {
  constructor(private readonly prisma: PrismaService) {}

  /** Newest contact first, capped at 500 — a flier campaign can drive real volume, and "most recent" is what an admin actually needs to triage. */
  @UseGuards(AdminGuard)
  @Get('contacts')
  async listContacts(): Promise<WhatsAppContactView[]> {
    const sessions = await this.prisma.whatsAppSession.findMany({
      orderBy: { lastInboundAt: 'desc' },
      take: 500,
    });

    const phones = sessions.map((s) => s.phone);
    const users = phones.length
      ? await this.prisma.user.findMany({
          where: { phone: { in: phones } },
          select: { id: true, name: true, phone: true, roleFlags: true },
        })
      : [];
    const userByPhone = new Map<string, (typeof users)[number]>();
    for (const u of users) {
      if (u.phone) userByPhone.set(u.phone, u);
    }

    return sessions.map((s) => {
      const user = userByPhone.get(s.phone);
      return {
        phone: s.phone,
        waProfileName: s.waProfileName,
        conversationState: s.conversationState,
        createdAt: s.createdAt,
        lastInboundAt: s.lastInboundAt,
        registeredUser: user ? { id: user.id, name: user.name, roles: user.roleFlags } : null,
      };
    });
  }
}
