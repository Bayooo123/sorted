import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { IdentityService } from '../identity/identity.service';
import { IdentityUser } from '../identity/identity.interface';
import { GigsService } from '../gigs/gigs.service';
import { EscrowService } from '../escrow/escrow.service';
import { RatingsService } from '../ratings/ratings.service';
import { LeadsService } from '../leads/leads.service';
import { LeadView } from '../leads/leads.interface';
import { WHATSAPP_PORT, WhatsAppPort } from './whatsapp.interface';
import { WhatsappCategoryClassifierService } from './whatsapp-category-classifier.service';

/**
 * WhatsApp integration Phase 2 (PLAN.md), superseded by "WhatsApp intake:
 * capture + human handoff" — a client describing a job no longer walks
 * through a guided category/location/price/assignment sequence and no
 * longer gets a Gig created (or funded) by the bot itself. The bot's job
 * now stops at: capture what they typed, best-effort tag it with a
 * category (reuses WhatsappCategoryClassifierService — the one AI call
 * this flow makes), save it as a Lead, and hand off to a human — who
 * contacts the client to agree pickup and price before a real Gig is
 * created through the app. Money/matching stays entirely human-decided;
 * see LeadsService and the admin leads.html page.
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
    private readonly config: ConfigService,
    private readonly identity: IdentityService,
    private readonly gigs: GigsService,
    private readonly escrow: EscrowService,
    private readonly ratings: RatingsService,
    private readonly leads: LeadsService,
    private readonly classifier: WhatsappCategoryClassifierService,
    @Inject(WHATSAPP_PORT) private readonly whatsapp: WhatsAppPort,
  ) {}

  private readonly browseKeywordRegex = /^(jobs|gigs|available|browse|see jobs|view jobs)$/i;
  private readonly postKeywordRegex = /^(post|post a job|post job|i want to post)$/i;
  private readonly menuKeywordRegex = /^(menu|help|commands|\?)$/i;

  async handle(user: IdentityUser, phone: string, text: string): Promise<void> {
    const trimmed = text.trim();
    if (/^(cancel|stop|start over)$/i.test(trimmed)) {
      await this.reset(phone);
      await this.whatsapp.sendMessage(phone, 'Cancelled — no problem. Text "jobs" to see available work, or tell me what you need done to post a job of your own.');
      return;
    }

    const session = await this.prisma.whatsAppSession.findUnique({ where: { phone } });
    const state = session?.conversationState ?? 'idle';

    // Global escape hatches — recognized in ANY state, not just idle, so
    // someone mid-flow isn't stuck answering the current question just to
    // see the job list or start a fresh post. MENU/HELP is informational
    // only and leaves the current flow alone; JOBS and POST interrupt it
    // the same way CANCEL does (see PLAN.md "Global WhatsApp commands"),
    // since this state machine has no resume-a-paused-flow mechanism to
    // preserve it instead.
    if (this.menuKeywordRegex.test(trimmed)) {
      await this.whatsapp.sendMessage(
        phone,
        'Commands:\nJOBS — see open work\nPOST — describe a job you need done\nCANCEL — stop what you\'re doing\n\nOtherwise, just answer my last message.',
      );
      return;
    }
    if (this.browseKeywordRegex.test(trimmed)) {
      await this.reset(phone);
      return this.showAvailableGigs(user, phone);
    }
    if (this.postKeywordRegex.test(trimmed)) {
      await this.reset(phone);
      await this.prisma.whatsAppSession.update({ where: { phone }, data: { conversationState: 'awaiting_post_description' } });
      await this.whatsapp.sendMessage(phone, 'Sure — tell me what you need done.');
      return;
    }

    switch (state) {
      case 'awaiting_reassignment':
        return this.handleReassignment(phone, trimmed, session!);
      case 'awaiting_rating':
        return this.handleRating(user, phone, trimmed, session!);
      case 'awaiting_gig_selection':
        return this.handleGigSelection(user, phone, trimmed, session!);
      case 'awaiting_post_description':
        return this.captureLead(phone, trimmed);
      case 'idle':
      default:
        return this.handleIdle(user, phone, trimmed);
    }
  }

  /**
   * Idle-state routing (product decision, not in PLAN.md until now — see
   * "Browse available gigs"). Previously every idle message was assumed
   * to be the start of a NEW gig description — correct for a client, but
   * wrong for anyone with a professional profile, hybrid accounts
   * included: "dry clean five shirts" from a dry cleaner means "that's my
   * trade," not "I want one." Applies to ANY account with the
   * professional role, not just professional-only ones — a hybrid
   * account is still, first, someone looking for work here. A pure
   * client (no professional role at all) is the only case where the old
   * assume-a-description default still makes sense, since they have
   * nothing to browse for. Anyone can still ask for the list explicitly
   * with a keyword regardless of role — and, since routing every
   * professional's idle message to browse means a hybrid account can no
   * longer post by just describing a job, "post" is the explicit escape
   * hatch back into that flow (asks for the description on the NEXT
   * message, rather than misreading "post" itself as one).
   *
   * JOBS/POST/MENU keywords are handled upstream in `handle()` now (see
   * "Global WhatsApp commands"), so by the time control reaches here the
   * text is neither — only the role-based default is left to decide.
   */
  private async handleIdle(user: IdentityUser, phone: string, text: string): Promise<void> {
    if (user.roles.includes('professional')) {
      return this.showAvailableGigs(user, phone);
    }
    return this.captureLead(phone, text);
  }

  /**
   * "View existing gigs" — pull-based counterpart to Phase 4's broadcast
   * push. Streamlined to the professional's OWN registered trade
   * (`serviceOfferingSubmarketIds`, the same picks made at role-profile
   * completion) rather than every open gig on the platform — a dry
   * cleaner has no use for a plumbing job in the list. Excludes gigs
   * restricted to a different named professional (Phase 3), same
   * reasoning as the public browse fix: nothing here is claimable by
   * anyone else.
   */
  private async showAvailableGigs(user: IdentityUser, phone: string): Promise<void> {
    if (!user.roles.includes('professional')) {
      await this.whatsapp.sendMessage(
        phone,
        "You'll need a professional profile to browse jobs — set one up at https://sorted.com.ng, then message me again.",
      );
      return;
    }
    if (user.serviceOfferingSubmarketIds.length === 0) {
      await this.whatsapp.sendMessage(
        phone,
        "You haven't set which trade you do yet — add that at https://sorted.com.ng and jobs matching you will show up here.",
      );
      return;
    }

    const gigs = await this.prisma.gig.findMany({
      where: {
        submarketId: { in: user.serviceOfferingSubmarketIds },
        status: 'open',
        restrictedToProfessionalId: null,
      },
      include: { submarket: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    if (gigs.length === 0) {
      await this.whatsapp.sendMessage(phone, "No open jobs matching your trade right now — I'll message you the moment one comes in.");
      return;
    }

    const lines = gigs.map((gig, i) => {
      const amountNaira = Number(gig.bountyKobo) / 100;
      return `${i + 1}. ${gig.description}\n   🏷️ ${gig.submarket.label}  📍 ${gig.locationText}  💰 ₦${amountNaira.toLocaleString('en-NG')}`;
    });

    await this.prisma.whatsAppSession.update({
      where: { phone },
      data: { conversationState: 'awaiting_gig_selection', browseGigIds: gigs.map((g) => g.id).join(',') },
    });

    await this.whatsapp.sendMessage(
      phone,
      `Open jobs matching your trade:\n\n${lines.join('\n\n')}\n\nReply with a number to claim one, or CANCEL to stop.`,
    );
  }

  private async handleGigSelection(
    user: IdentityUser,
    phone: string,
    reply: string,
    session: { browseGigIds: string | null },
  ): Promise<void> {
    const ids = session.browseGigIds?.split(',').filter(Boolean) ?? [];
    const index = Number.parseInt(reply, 10);
    const gigId = Number.isInteger(index) ? ids[index - 1] : undefined;

    if (!gigId) {
      await this.whatsapp.sendMessage(phone, `Please reply with just the number, 1 to ${ids.length}, or CANCEL to stop.`);
      return;
    }

    let gig;
    try {
      await this.escrow.holdStake(gigId, user.id);
      gig = await this.gigs.getGig(gigId);
    } catch (err) {
      this.logger.warn(`Browse-claim failed for gig ${gigId}, professional ${user.id}: ${err instanceof Error ? err.message : err}`);
      await this.whatsapp.sendMessage(phone, "Sorry — that job's already been taken (or is no longer available). Text \"jobs\" to see what's still open.");
      await this.resetToIdle(phone);
      return;
    }

    await this.resetToIdle(phone);
    await this.whatsapp.sendMessage(
      phone,
      `You got it! "${gig.title}" is yours now — open the Sorted app to see full details and submit your work when it's done.`,
    );

    const client = await this.identity.getUser(gig.clientId);
    if (client.phone) {
      const firstName = user.name?.trim().split(/\s+/)[0] ?? 'A professional';
      await this.whatsapp.sendMessage(client.phone, `🎉 ${firstName} claimed your job! They'll be in touch.`);
    }
  }

  private async resetToIdle(phone: string): Promise<void> {
    await this.prisma.whatsAppSession.update({ where: { phone }, data: { conversationState: 'idle', browseGigIds: null } });
  }

  /**
   * PLAN.md "WhatsApp intake: capture + human handoff" — the entire
   * replacement for the old category/location/price/assignment/confirm
   * sequence. Reuses WhatsappCategoryClassifierService (the same Claude
   * call "AI category classification" already made) purely to tag the
   * lead for the admin's benefit — it never gates or blocks on the
   * result, unlike the old flow where an unconfident guess meant a whole
   * extra menu step. Nothing here prices, matches, or creates a Gig;
   * that's a human decision now, made after they've actually talked to
   * the client — see LeadsService and the admin leads.html page.
   */
  private async captureLead(phone: string, text: string): Promise<void> {
    if (text.length < 3) {
      await this.whatsapp.sendMessage(phone, 'Tell me a bit more about what you need done — e.g. "dry clean 3 shirts and a suit".');
      return;
    }

    const session = await this.prisma.whatsAppSession.findUnique({ where: { phone } });
    const submarkets = await this.listSubmarkets();
    const guessed = await this.classifier.classify(text, submarkets);

    const lead = await this.leads.captureLead({
      phone,
      waProfileName: session?.waProfileName ?? null,
      message: text,
      submarketGuess: guessed?.key ?? null,
    });

    await this.resetToIdle(phone);

    const categoryLine = guessed ? ` — sounds like a *${guessed.label}* job` : '';
    await this.whatsapp.sendMessage(
      phone,
      `Got it${categoryLine}! 🙌 A member of the Sorted team will reach out to you shortly to arrange pickup and confirm pricing. Thanks for reaching out!`,
    );

    await this.notifyFounderOfLead(lead, guessed?.label).catch((err) => {
      this.logger.warn(`Lead notification failed for lead ${lead.id}: ${err instanceof Error ? err.message : err}`);
    });
  }

  /**
   * Best-effort, same reasoning as every other notification hook in this
   * codebase: a failed notify must never fail the lead capture that
   * already saved successfully above. Closes the loop on the bot's own
   * promise ("a human will reach out shortly") — without this, that line
   * is only true once someone happens to check the leads page.
   * LEAD_NOTIFICATION_PHONE unset -> silent no-op, same "unconfigured
   * means skip, not crash" pattern as the KWIK/WhatsApp template config.
   */
  private async notifyFounderOfLead(lead: LeadView, categoryLabel?: string): Promise<void> {
    const notifyPhone = this.config.get<string>('LEAD_NOTIFICATION_PHONE');
    if (!notifyPhone) return;

    const who = lead.waProfileName ? `${lead.waProfileName} (${lead.phone})` : lead.phone;
    const category = categoryLabel ? ` [${categoryLabel}]` : '';
    await this.whatsapp.sendMessage(
      notifyPhone,
      `🆕 New lead${category}\n${who}\n"${lead.message}"\n\nReply to them on WhatsApp to arrange pickup and price.`,
    );
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
    const sent = await this.gigs.sendInvite(gigId);

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
        browseGigIds: null,
      },
    });
  }

  private async listSubmarkets() {
    return this.prisma.submarket.findMany({ orderBy: { label: 'asc' } });
  }
}
