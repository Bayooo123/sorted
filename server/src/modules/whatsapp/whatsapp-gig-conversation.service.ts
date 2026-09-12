import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IdentityService } from '../identity/identity.service';
import { IdentityUser } from '../identity/identity.interface';
import { GigsService } from '../gigs/gigs.service';
import { EscrowService } from '../escrow/escrow.service';
import { RatingsService } from '../ratings/ratings.service';
import { kobo } from '../../common/money';
import { WHATSAPP_PORT, WhatsAppPort } from './whatsapp.interface';

/**
 * WhatsApp integration Phase 2 (PLAN.md) — a registered client can post a
 * real gig by texting, no app needed. Deliberately a guided, numbered-menu
 * sequence ("USSD-style", per the original product brief) rather than
 * free-text NLP extraction: taxonomy/location/price are hard requirements
 * of GigsService.createGig, and a wrong NLP guess on a money field is a
 * worse failure mode than one extra question.
 *
 * State lives on WhatsAppSession (one row per phone, already used for the
 * 24h session window) rather than a separate table — this conversation is
 * the only stateful thing WhatsApp does today, and a gig-posting session
 * and a messaging session share the same identity (the phone).
 */
@Injectable()
export class WhatsappGigConversationService {
  private readonly logger = new Logger(WhatsappGigConversationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly gigs: GigsService,
    private readonly escrow: EscrowService,
    private readonly ratings: RatingsService,
    @Inject(WHATSAPP_PORT) private readonly whatsapp: WhatsAppPort,
  ) {}

  async handle(user: IdentityUser, phone: string, text: string): Promise<void> {
    const trimmed = text.trim();
    if (/^(cancel|stop|start over)$/i.test(trimmed)) {
      await this.reset(phone);
      await this.whatsapp.sendMessage(phone, "Cancelled — no problem. Tell me what you need done whenever you're ready.");
      return;
    }

    const session = await this.prisma.whatsAppSession.findUnique({ where: { phone } });
    const state = session?.conversationState ?? 'idle';

    switch (state) {
      case 'awaiting_category':
        return this.handleCategory(phone, trimmed);
      case 'awaiting_location':
        return this.handleLocation(phone, trimmed);
      case 'awaiting_price':
        return this.handlePrice(phone, trimmed);
      case 'awaiting_assignment_mode':
        return this.handleAssignmentMode(phone, trimmed, session!);
      case 'awaiting_invitee_phone':
        return this.handleInviteePhone(phone, trimmed, session!);
      case 'awaiting_confirmation':
        return this.handleConfirmation(user, phone, trimmed, session!);
      case 'awaiting_reassignment':
        return this.handleReassignment(phone, trimmed, session!);
      case 'awaiting_rating':
        return this.handleRating(user, phone, trimmed, session!);
      case 'idle':
      default:
        return this.startDraft(phone, trimmed);
    }
  }

  private async startDraft(phone: string, description: string): Promise<void> {
    if (description.length < 3) {
      await this.whatsapp.sendMessage(phone, "Tell me a bit more about what you need done — e.g. \"fix a leaking kitchen tap\".");
      return;
    }

    const submarkets = await this.listSubmarkets();
    await this.prisma.whatsAppSession.update({
      where: { phone },
      data: {
        conversationState: 'awaiting_category',
        draftDescription: description,
        draftSubmarketId: null,
        draftLocationText: null,
        draftBountyKobo: null,
        draftInviteeProfessionalId: null,
        draftInviteeName: null,
      },
    });

    await this.whatsapp.sendMessage(phone, `Got it. What kind of job is this?\n\n${this.numberedList(submarkets)}\n\nReply with the number.`);
  }

  private async handleCategory(phone: string, reply: string): Promise<void> {
    const submarkets = await this.listSubmarkets();
    const index = Number.parseInt(reply, 10);
    const chosen = Number.isInteger(index) ? submarkets[index - 1] : undefined;

    if (!chosen) {
      await this.whatsapp.sendMessage(phone, `Please reply with just the number, 1 to ${submarkets.length}.\n\n${this.numberedList(submarkets)}`);
      return;
    }

    await this.prisma.whatsAppSession.update({
      where: { phone },
      data: { conversationState: 'awaiting_location', draftSubmarketId: chosen.id },
    });
    await this.whatsapp.sendMessage(phone, 'Where should this be done? (e.g. "Abule Oja, Yaba" or a full address)');
  }

  private async handleLocation(phone: string, location: string): Promise<void> {
    if (location.length < 3) {
      await this.whatsapp.sendMessage(phone, 'Please share the area or address where the work is needed.');
      return;
    }

    await this.prisma.whatsAppSession.update({
      where: { phone },
      data: { conversationState: 'awaiting_price', draftLocationText: location },
    });
    await this.whatsapp.sendMessage(phone, 'How much are you paying for this? Reply with just the amount, e.g. 15000');
  }

  private async handlePrice(phone: string, reply: string): Promise<void> {
    const amountNaira = this.parseNaira(reply);
    if (!amountNaira || amountNaira <= 0) {
      await this.whatsapp.sendMessage(phone, "Sorry, I didn't get that — reply with just the amount in naira, e.g. 15000");
      return;
    }

    await this.prisma.whatsAppSession.update({
      where: { phone },
      data: { conversationState: 'awaiting_assignment_mode', draftBountyKobo: BigInt(Math.round(amountNaira * 100)) },
    });

    await this.whatsapp.sendMessage(
      phone,
      'One more thing — do you already have someone in mind for this, or should I open it up to any professional in that category?\n\n1. Invite someone I know\n2. Open it up (search)\n\nReply with the number.',
    );
  }

  private async handleAssignmentMode(
    phone: string,
    reply: string,
    session: { draftSubmarketId: string | null },
  ): Promise<void> {
    if (/^(1|invite|someone|know)$/i.test(reply)) {
      await this.prisma.whatsAppSession.update({
        where: { phone },
        data: { conversationState: 'awaiting_invitee_phone' },
      });
      await this.whatsapp.sendMessage(phone, "What's their WhatsApp number? (e.g. 08031234567)");
      return;
    }

    if (/^(2|open|search|anyone)$/i.test(reply)) {
      await this.prisma.whatsAppSession.update({
        where: { phone },
        data: { conversationState: 'awaiting_confirmation', draftInviteeProfessionalId: null, draftInviteeName: null },
      });
      await this.sendRecap(phone, session.draftSubmarketId!);
      return;
    }

    await this.whatsapp.sendMessage(phone, 'Reply 1 to invite someone you know, or 2 to open the job up to any professional.');
  }

  private async handleInviteePhone(
    phone: string,
    reply: string,
    session: { draftSubmarketId: string | null },
  ): Promise<void> {
    if (/^(2|open|search|anyone)$/i.test(reply)) {
      await this.prisma.whatsAppSession.update({
        where: { phone },
        data: { conversationState: 'awaiting_confirmation', draftInviteeProfessionalId: null, draftInviteeName: null },
      });
      await this.sendRecap(phone, session.draftSubmarketId!);
      return;
    }

    const invitee = await this.identity.findUserByPhone(reply);
    if (!invitee) {
      await this.whatsapp.sendMessage(
        phone,
        "I couldn't find a Sorted account with that number. They'll need to sign up first (https://sorted.com.ng) — or reply \"search\" to open this job to any matching professional instead.",
      );
      return;
    }
    if (!invitee.roles.includes('professional')) {
      await this.whatsapp.sendMessage(
        phone,
        "That number's on Sorted but not set up as a professional yet — try another number, or reply \"search\" to open this job to any matching professional instead.",
      );
      return;
    }

    await this.prisma.whatsAppSession.update({
      where: { phone },
      data: {
        conversationState: 'awaiting_confirmation',
        draftInviteeProfessionalId: invitee.id,
        draftInviteeName: invitee.name,
      },
    });
    await this.sendRecap(phone, session.draftSubmarketId!, invitee.name);
  }

  private async sendRecap(phone: string, submarketId: string, inviteeName?: string | null): Promise<void> {
    const session = await this.prisma.whatsAppSession.findUniqueOrThrow({ where: { phone } });
    const submarket = await this.prisma.submarket.findUniqueOrThrow({ where: { id: submarketId } });
    const amountNaira = Number(session.draftBountyKobo) / 100;

    const assignmentLine = inviteeName ? `👤 Sent directly to ${inviteeName} to accept or decline` : `🔍 Open to any matching professional`;

    const summary =
      `Here's the job:\n\n` +
      `📝 ${session.draftDescription}\n` +
      `🏷️ ${submarket.label}\n` +
      `📍 ${session.draftLocationText}\n` +
      `💰 You pay: ₦${amountNaira.toLocaleString('en-NG')}\n` +
      `${assignmentLine}\n\n` +
      `Reply YES to post it, or CANCEL to start over.`;
    await this.whatsapp.sendMessage(phone, summary);
  }

  private async handleConfirmation(
    user: IdentityUser,
    phone: string,
    reply: string,
    session: {
      draftDescription: string | null;
      draftSubmarketId: string | null;
      draftLocationText: string | null;
      draftBountyKobo: bigint | null;
      draftInviteeProfessionalId: string | null;
    },
  ): Promise<void> {
    if (!/^(yes|y|confirm|post it)$/i.test(reply)) {
      await this.whatsapp.sendMessage(phone, 'Reply YES to post this job, or CANCEL to start over.');
      return;
    }

    const { draftDescription, draftSubmarketId, draftLocationText, draftBountyKobo, draftInviteeProfessionalId } = session;
    if (!draftDescription || !draftSubmarketId || !draftLocationText || !draftBountyKobo) {
      // Shouldn't happen (all four are set before reaching awaiting_confirmation) — recover rather than crash mid-conversation.
      await this.reset(phone);
      await this.whatsapp.sendMessage(phone, "Something went wrong on my end — let's start over. Tell me what you need done.");
      return;
    }

    if (!user.roles.includes('client')) {
      await this.identity.completeRoleProfile(user.id, {
        roles: user.roles.includes('professional') ? [...user.roles, 'client'] : ['client'],
        serviceOfferingSubmarketIds: user.roles.includes('professional') ? user.serviceOfferingSubmarketIds : undefined,
        seekingCategorySubmarketIds: [draftSubmarketId],
      });
    }

    const submarket = await this.prisma.submarket.findUniqueOrThrow({
      where: { id: draftSubmarketId },
      include: { domain: true },
    });
    if (!submarket.domain) {
      // Every seeded submarket belongs to a domain (see prisma/seed.ts) —
      // domainId is nullable at the schema level but not in practice.
      throw new Error(`Submarket "${submarket.key}" has no domain — data integrity issue`);
    }

    const gig = await this.gigs.createGig({
      clientId: user.id,
      title: draftDescription.slice(0, 200),
      description: draftDescription,
      domain: submarket.domain.key,
      submarket: submarket.key,
      clientType: 'individual',
      locationText: draftLocationText,
      materialsMode: 'bounty_covers',
      bountyKobo: kobo(Number(draftBountyKobo)),
      criteria: [draftDescription],
      restrictedToProfessionalId: draftInviteeProfessionalId ?? undefined,
    });
    await this.gigs.publishGig(gig.id);
    const escrowRecord = await this.escrow.fundGig(gig.id);

    await this.reset(phone);

    const amountNaira = Number(draftBountyKobo) / 100;
    // The invited professional (if any) is only messaged once EscrowService
    // confirms funding — see EscrowService.sendInvite — so there's nothing
    // more to tell the client here about that leg yet.
    if (escrowRecord.holdingAccount?.checkoutUrl) {
      await this.whatsapp.sendMessage(
        phone,
        `Job posted! To make it live, pay ₦${amountNaira.toLocaleString('en-NG')} here:\n${escrowRecord.holdingAccount.checkoutUrl}\n\nOnce payment is confirmed, your job goes live${draftInviteeProfessionalId ? " and we'll send the invite" : ''}.`,
      );
    } else {
      const { accountNumber, bankName } = escrowRecord.holdingAccount ?? {};
      await this.whatsapp.sendMessage(
        phone,
        `Job posted! To make it live, transfer ₦${amountNaira.toLocaleString('en-NG')} to:\n${bankName ?? 'Sorted'} — ${accountNumber ?? '(see sorted.com.ng)'}\n\nOnce we confirm receipt, your job goes live${draftInviteeProfessionalId ? " and we'll send the invite" : ''}.`,
      );
    }
  }

  /**
   * The follow-up when a direct invite didn't pan out — a decline
   * (WhatsappInviteService) or an unreachable professional
   * (EscrowService.sendInvite) both land the CLIENT here via
   * WhatsAppPort.offerReassignment. `session.reassignGigId` names an
   * EXISTING, already-posted-and-funded gig — nothing here creates a new
   * one, unlike the rest of this class.
   */
  private async handleReassignment(
    phone: string,
    reply: string,
    session: { reassignGigId: string | null },
  ): Promise<void> {
    const gigId = session.reassignGigId;
    if (!gigId) {
      await this.reset(phone);
      return;
    }

    if (/^(open|search|anyone)$/i.test(reply)) {
      await this.gigs.setRestrictedProfessional(gigId, null);
      await this.reset(phone);
      await this.whatsapp.sendMessage(phone, 'Opened up — any matching professional can now claim this job.');
      return;
    }

    const invitee = await this.identity.findUserByPhone(reply);
    if (!invitee) {
      await this.whatsapp.sendMessage(
        phone,
        "I couldn't find a Sorted account with that number. Try another number, or reply OPEN to open the job to any matching professional.",
      );
      return;
    }
    if (!invitee.roles.includes('professional')) {
      await this.whatsapp.sendMessage(
        phone,
        "That number's on Sorted but not set up as a professional yet. Try another number, or reply OPEN.",
      );
      return;
    }

    await this.gigs.setRestrictedProfessional(gigId, invitee.id);
    const sent = await this.escrow.sendInvite(gigId);

    if (sent) {
      await this.reset(phone);
      await this.whatsapp.sendMessage(phone, `Invite sent to ${invitee.name ?? 'them'}.`);
    }
    // sent === false: EscrowService.sendInvite has already put this phone
    // back into awaiting_reassignment and messaged the client itself (see
    // its own doc comment) — nothing more to do here, and sending a
    // second "couldn't reach them" message would just be a duplicate.
  }

  /**
   * The reply to EscrowService's post-release prompt (PLAN.md "Simple
   * professional ratings") — `session.pendingRatingGigId` names the
   * just-paid-out gig. Anything that isn't a clean 1-5 re-asks rather
   * than guessing; a rating is a real, attributed record, not worth
   * accepting a fuzzy match on.
   */
  private async handleRating(
    user: IdentityUser,
    phone: string,
    reply: string,
    session: { pendingRatingGigId: string | null },
  ): Promise<void> {
    const gigId = session.pendingRatingGigId;
    if (!gigId) {
      await this.reset(phone);
      return;
    }

    const stars = Number.parseInt(reply, 10);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5 || reply.trim() !== String(stars)) {
      await this.whatsapp.sendMessage(phone, 'Just reply with a single number from 1 to 5.');
      return;
    }

    const rating = await this.ratings.rateGig(gigId, user.id, stars);
    await this.reset(phone);
    await this.whatsapp.sendMessage(phone, 'Thanks for the feedback!');

    // Positioning decision (PLAN.md "Track Record positioning"): the
    // record being built is the professional's, and the moment it just
    // grew is the moment it should be said out loud to them — not left as
    // a line in onboarding copy nobody re-reads. Best-effort, same
    // reasoning as every other WhatsApp notification here: this must
    // never fail the rating that already saved successfully above.
    await this.notifyProfessionalOfTrackRecord(rating.rateeId).catch((err) => {
      this.logger.warn(`Track Record notification failed for professional ${rating.rateeId}: ${err instanceof Error ? err.message : err}`);
    });
  }

  private async notifyProfessionalOfTrackRecord(professionalId: string): Promise<void> {
    const professional = await this.identity.getUser(professionalId);
    if (!professional.phone) return;

    const summary = await this.ratings.getProfessionalRatingSummary(professionalId);
    const avg = summary.average ? summary.average.toFixed(1) : '—';
    const jobWord = summary.count === 1 ? 'job' : 'jobs';

    await this.whatsapp.sendMessage(
      professional.phone,
      `That's ${summary.count} ${jobWord} on your Sorted Track Record now — ★${avg} avg. Keep it going: professionals who build a real record here get first pick of new jobs, and it's the kind of proof that opens doors most people never get handed for free.`,
    );
  }

  private async reset(phone: string): Promise<void> {
    await this.prisma.whatsAppSession.update({
      where: { phone },
      data: {
        conversationState: 'idle',
        draftDescription: null,
        draftSubmarketId: null,
        draftLocationText: null,
        draftBountyKobo: null,
        draftInviteeProfessionalId: null,
        draftInviteeName: null,
        reassignGigId: null,
        pendingRatingGigId: null,
      },
    });
  }

  private async listSubmarkets() {
    return this.prisma.submarket.findMany({ orderBy: { label: 'asc' } });
  }

  private numberedList(items: { label: string }[]): string {
    return items.map((item, i) => `${i + 1}. ${item.label}`).join('\n');
  }

  /** Accepts "15000", "15,000", "₦15000", "15k" — rejects anything else rather than guessing. */
  private parseNaira(input: string): number | null {
    const cleaned = input.trim().replace(/[₦,\s]/g, '');
    const kMatch = /^(\d+(?:\.\d+)?)k$/i.exec(cleaned);
    const value = kMatch ? Number.parseFloat(kMatch[1]) * 1000 : Number.parseFloat(cleaned);
    return Number.isFinite(value) && value > 0 ? value : null;
  }
}
