import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IdentityService } from '../identity/identity.service';
import { IdentityUser } from '../identity/identity.interface';
import { GigsService } from '../gigs/gigs.service';
import { EscrowService } from '../escrow/escrow.service';
import { WHATSAPP_PORT, WhatsAppPort } from './whatsapp.interface';

/**
 * The claiming side of "open it up to any matching professional" (PLAN.md
 * "WhatsApp integration, Phase 4") — handles a YES reply from anyone
 * EscrowService.broadcastOpenGig messaged. Separate from
 * WhatsappInviteService (one named professional, YES/NO) because the
 * shape is genuinely different here: many phones can be racing for the
 * same gig, and a claim winning means telling everyone ELSE it's gone —
 * not just resolving one person's own pending state.
 */
@Injectable()
export class WhatsappBroadcastService {
  private readonly logger = new Logger(WhatsappBroadcastService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly gigs: GigsService,
    private readonly escrow: EscrowService,
    @Inject(WHATSAPP_PORT) private readonly whatsapp: WhatsAppPort,
  ) {}

  async handleReply(user: IdentityUser, phone: string, text: string, gigId: string): Promise<void> {
    const trimmed = text.trim();
    if (!/^(yes|y|accept|claim)$/i.test(trimmed)) {
      await this.whatsapp.sendMessage(phone, 'This job may still be available — reply YES to claim it (first come, first served).');
      return;
    }

    if (!user.roles.includes('professional')) {
      await this.clearPending(phone);
      await this.whatsapp.sendMessage(
        phone,
        "Claiming a job needs a professional account, which yours isn't set up as yet — set that up at https://sorted.com.ng.",
      );
      return;
    }

    let gig;
    try {
      await this.escrow.holdStake(gigId, user.id);
      gig = await this.gigs.getGig(gigId);
    } catch {
      // The real, expected way to lose the race — someone else's holdStake
      // committed first, or the gig moved on for some other reason. Not
      // logged as a warning; this is normal operation, not a bug.
      await this.clearPending(phone);
      await this.whatsapp.sendMessage(phone, "Sorry — that job's already been taken (or is no longer available).");
      return;
    }

    await this.clearPending(phone);
    await this.whatsapp.sendMessage(
      phone,
      `You got it! "${gig.title}" is yours now — open the Sorted app to see full details and submit your work when it's done.`,
    );

    const client = await this.identity.getUser(gig.clientId);
    if (client.phone) {
      const firstName = user.name?.trim().split(/\s+/)[0] ?? 'A professional';
      await this.whatsapp.sendMessage(client.phone, `🎉 ${firstName} claimed your job! They'll be in touch.`);
    }

    await this.notifyLosers(gigId, phone).catch((err) => {
      this.logger.warn(`Notifying non-winners failed for gig ${gigId}: ${err instanceof Error ? err.message : err}`);
    });
  }

  /** Everyone else the same gig was broadcast to — cleared and told it's gone, so a late "YES" doesn't re-attempt a claim that will just fail anyway. */
  private async notifyLosers(gigId: string, winnerPhone: string): Promise<void> {
    const others = await this.prisma.whatsAppSession.findMany({
      where: { pendingBroadcastGigId: gigId, phone: { not: winnerPhone } },
      select: { phone: true },
    });

    await Promise.all(
      others.map(async ({ phone }) => {
        await this.prisma.whatsAppSession.update({ where: { phone }, data: { pendingBroadcastGigId: null } }).catch(() => {});
        await this.whatsapp
          .sendMessage(phone, "That job's been claimed by someone else — thanks for your interest! We'll let you know about the next one.")
          .catch(() => {});
      }),
    );
  }

  private async clearPending(phone: string): Promise<void> {
    await this.prisma.whatsAppSession.update({ where: { phone }, data: { pendingBroadcastGigId: null } }).catch(() => {
      // Session row missing is unreachable in practice (broadcastOpenGig creates it before sending) — swallow rather than crash the reply.
    });
  }
}
