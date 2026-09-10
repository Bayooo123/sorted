import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IdentityService } from '../identity/identity.service';
import { IdentityUser } from '../identity/identity.interface';
import { GigsService } from '../gigs/gigs.service';
import { EscrowService } from '../escrow/escrow.service';
import { WHATSAPP_PORT, WhatsAppPort } from './whatsapp.interface';

/**
 * The professional's side of "invite someone I already know" (PLAN.md
 * "WhatsApp integration, Phase 3") — handles a YES/NO reply to the invite
 * EscrowService sends once the client's payment is confirmed. Separate
 * from WhatsappGigConversationService (the client's posting flow): these
 * are two different people's conversations, tracked independently via
 * WhatsAppSession.pendingInviteGigId vs. conversationState.
 */
@Injectable()
export class WhatsappInviteService {
  private readonly logger = new Logger(WhatsappInviteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly gigs: GigsService,
    private readonly escrow: EscrowService,
    @Inject(WHATSAPP_PORT) private readonly whatsapp: WhatsAppPort,
  ) {}

  async handleReply(user: IdentityUser, phone: string, text: string, gigId: string): Promise<void> {
    const trimmed = text.trim();

    if (/^(yes|y|accept)$/i.test(trimmed)) {
      await this.accept(user, phone, gigId);
      return;
    }
    if (/^(no|n|decline)$/i.test(trimmed)) {
      await this.decline(user, phone, gigId);
      return;
    }
    await this.whatsapp.sendMessage(phone, 'You have a pending job invite — reply YES to accept, or NO to decline.');
  }

  private async accept(user: IdentityUser, phone: string, gigId: string): Promise<void> {
    if (!user.roles.includes('professional')) {
      await this.clearPendingInvite(phone);
      await this.whatsapp.sendMessage(
        phone,
        "This invite needs a professional account, which yours isn't set up as yet — set that up at https://sorted.com.ng, then ask them to send the invite again.",
      );
      return;
    }

    let gig;
    try {
      await this.escrow.holdStake(gigId, user.id);
      gig = await this.gigs.getGig(gigId);
    } catch (err) {
      this.logger.warn(`Invite accept failed for gig ${gigId}, professional ${user.id}: ${err instanceof Error ? err.message : err}`);
      await this.clearPendingInvite(phone);
      await this.whatsapp.sendMessage(phone, "Sorry, this job isn't available to claim anymore — it may already have been taken or cancelled.");
      return;
    }

    await this.clearPendingInvite(phone);
    await this.whatsapp.sendMessage(
      phone,
      `You're in! "${gig.title}" is yours now — open the Sorted app to see full details and submit your work when it's done.`,
    );

    const client = await this.identity.getUser(gig.clientId);
    if (client.phone) {
      const firstName = user.name?.trim().split(/\s+/)[0] ?? 'Your professional';
      await this.whatsapp.sendMessage(client.phone, `🎉 ${firstName} accepted your job! They'll be in touch.`);
    }
  }

  private async decline(user: IdentityUser, phone: string, gigId: string): Promise<void> {
    await this.clearPendingInvite(phone);
    await this.whatsapp.sendMessage(phone, 'No problem — declined.');

    let gig;
    try {
      gig = await this.gigs.getGig(gigId);
    } catch {
      return; // gig gone — nothing left to notify
    }

    const client = await this.identity.getUser(gig.clientId);
    if (client.phone) {
      const firstName = user.name?.trim().split(/\s+/)[0] ?? 'The professional you invited';
      await this.whatsapp.offerReassignment(client.phone, gigId, `${firstName} wasn't able to take this job.`);
    }
  }

  private async clearPendingInvite(phone: string): Promise<void> {
    await this.prisma.whatsAppSession.update({ where: { phone }, data: { pendingInviteGigId: null } }).catch(() => {
      // Session row missing is unreachable in practice (EscrowService creates it before sending the invite) — swallow rather than crash the reply.
    });
  }
}
