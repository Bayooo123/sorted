import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IdentityService } from '../identity/identity.service';
import { IdentityUser } from '../identity/identity.interface';
import { GigsService } from '../gigs/gigs.service';
import { EscrowService } from '../escrow/escrow.service';
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
      case 'awaiting_confirmation':
        return this.handleConfirmation(user, phone, trimmed, session!);
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

    const session = await this.prisma.whatsAppSession.update({
      where: { phone },
      data: { conversationState: 'awaiting_confirmation', draftBountyKobo: BigInt(Math.round(amountNaira * 100)) },
    });

    const submarket = await this.prisma.submarket.findUniqueOrThrow({ where: { id: session.draftSubmarketId! } });
    const summary =
      `Here's the job:\n\n` +
      `📝 ${session.draftDescription}\n` +
      `🏷️ ${submarket.label}\n` +
      `📍 ${session.draftLocationText}\n` +
      `💰 You pay: ₦${amountNaira.toLocaleString('en-NG')}\n\n` +
      `Reply YES to post it, or CANCEL to start over.`;
    await this.whatsapp.sendMessage(phone, summary);
  }

  private async handleConfirmation(
    user: IdentityUser,
    phone: string,
    reply: string,
    session: { draftDescription: string | null; draftSubmarketId: string | null; draftLocationText: string | null; draftBountyKobo: bigint | null },
  ): Promise<void> {
    if (!/^(yes|y|confirm|post it)$/i.test(reply)) {
      await this.whatsapp.sendMessage(phone, 'Reply YES to post this job, or CANCEL to start over.');
      return;
    }

    const { draftDescription, draftSubmarketId, draftLocationText, draftBountyKobo } = session;
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
    });
    await this.gigs.publishGig(gig.id);
    const escrowRecord = await this.escrow.fundGig(gig.id);

    await this.reset(phone);

    const amountNaira = Number(draftBountyKobo) / 100;
    if (escrowRecord.holdingAccount?.checkoutUrl) {
      await this.whatsapp.sendMessage(
        phone,
        `Job posted! To make it live for professionals, pay ₦${amountNaira.toLocaleString('en-NG')} here:\n${escrowRecord.holdingAccount.checkoutUrl}\n\nOnce payment is confirmed, your job goes live.`,
      );
    } else {
      const { accountNumber, bankName } = escrowRecord.holdingAccount ?? {};
      await this.whatsapp.sendMessage(
        phone,
        `Job posted! To make it live, transfer ₦${amountNaira.toLocaleString('en-NG')} to:\n${bankName ?? 'Sorted'} — ${accountNumber ?? '(see sorted.com.ng)'}\n\nOnce we confirm receipt, your job goes live.`,
      );
    }
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
