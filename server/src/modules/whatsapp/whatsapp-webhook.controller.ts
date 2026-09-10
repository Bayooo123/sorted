import { Controller, Get, Headers, HttpCode, Inject, Logger, Post, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { waitUntil } from '@vercel/functions';
import * as crypto from 'crypto';
import type { Request, Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { IdentityService } from '../identity/identity.service';
import { WHATSAPP_PORT, WhatsAppPort } from './whatsapp.interface';
import { WhatsappGigConversationService } from './whatsapp-gig-conversation.service';
import { WhatsappInviteService } from './whatsapp-invite.service';
import { WhatsappBroadcastService } from './whatsapp-broadcast.service';

interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

/**
 * Meta Cloud API webhook — GET for the one-time verification handshake,
 * POST for every inbound message/status callback afterward. Lives in its
 * own module (not whatsapp.module.ts) specifically because it needs
 * IdentityService (to look up whether an inbound phone is a registered
 * user) — see whatsapp.interface.ts's doc comment for the circular-
 * dependency this avoids. Nothing imports this module except AppModule.
 */
@Controller('webhooks/whatsapp')
export class WhatsappWebhookController {
  private readonly logger = new Logger(WhatsappWebhookController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    @Inject(WHATSAPP_PORT) private readonly whatsapp: WhatsAppPort,
    private readonly gigConversation: WhatsappGigConversationService,
    private readonly invites: WhatsappInviteService,
    private readonly broadcasts: WhatsappBroadcastService,
  ) {}

  /**
   * Must echo hub.challenge back as the raw response body (not
   * JSON-wrapped — @Res() bypasses Nest's default JSON serialization) or
   * Meta considers verification failed and never calls POST below. Set
   * WHATSAPP_VERIFY_TOKEN to any value you choose, then enter that same
   * value in Meta's dashboard when configuring the webhook URL.
   */
  @Get()
  verify(@Query() query: Record<string, string>, @Res() res: Response) {
    const expected = this.config.get<string>('WHATSAPP_VERIFY_TOKEN');
    if (expected && query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === expected) {
      res.status(200).send(query['hub.challenge']);
      return;
    }
    this.logger.warn('WhatsApp webhook verification attempt failed');
    res.status(401).send('Verification failed');
  }

  @Post()
  @HttpCode(200)
  handle(@Req() req: RequestWithRawBody, @Headers('x-hub-signature-256') signature?: string) {
    const rawBody = req.rawBody ?? Buffer.alloc(0);
    if (!this.verifySignature(rawBody, signature)) {
      this.logger.warn('WhatsApp webhook signature verification failed — ignoring');
      return { received: true };
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return { received: true };
    }

    // Always 200 immediately — Meta retries aggressively on anything else,
    // and retrying a message we're deliberately ignoring is noise, not a
    // fix (same reasoning as PaystackWebhookController). Real processing
    // happens after the response is sent, kept alive via waitUntil — the
    // primitive Next.js's after() sits on top of — rather than racing the
    // serverless function's teardown. Outside Vercel (local dev) this is a
    // harmless no-op; the promise runs regardless, see wait-until.js.
    waitUntil(
      this.processPayload(payload).catch((err) => {
        this.logger.error(`WhatsApp webhook processing failed: ${err instanceof Error ? err.message : err}`);
      }),
    );

    return { received: true };
  }

  private verifySignature(rawBody: Buffer, signature: string | undefined): boolean {
    const appSecret = this.config.get<string>('WHATSAPP_APP_SECRET');
    // Soft-allow when unset, matching this codebase's existing pattern
    // (PaystackWebhookController's IP-allowlist) for a value that can't be
    // required until initial Meta dashboard setup is complete — tighten
    // once WHATSAPP_APP_SECRET is configured.
    if (!appSecret) return true;
    if (!signature) return false;
    const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  private async processPayload(payload: unknown): Promise<void> {
    const value = (payload as WhatsAppWebhookPayload)?.entry?.[0]?.changes?.[0]?.value;
    const messages = value?.messages;
    if (!Array.isArray(messages)) return; // delivery/read status callbacks land here too — nothing to act on yet
    for (const message of messages) {
      await this.handleMessage(message);
    }
  }

  private async handleMessage(message: WhatsAppInboundMessage): Promise<void> {
    // Meta sends the sender with no "+" and the full country code (e.g.
    // "2348031234567") — our own User.phone is always strict E.164
    // ("+2348031234567", enforced at signup/profile-update), so this is
    // the entire normalization needed on this side, unlike a system
    // matching against inconsistently-entered user input.
    const phone = `+${message.from}`;
    await this.whatsapp.recordInboundMessage(phone);

    // Exhaustive on purpose — every message type Meta can send gets an
    // explicit branch, even though most just reply "not supported yet."
    // Silently dropping an unhandled type looks identical to the bot
    // being broken; there is no default-to-nothing case here.
    switch (message.type) {
      case 'text':
        await this.handleText(phone, message.text?.body ?? '');
        return;
      case 'image':
      case 'document':
      case 'audio':
      case 'video':
      case 'sticker':
      case 'location':
      case 'contacts':
      case 'interactive':
      case 'button':
      case 'reaction':
      default:
        await this.whatsapp.sendMessage(
          phone,
          "I can only read text messages right now — reply with words and I'll help you out.",
        );
    }
  }

  /**
   * Unregistered sender -> the signup link (Phase 1). Registered sender
   * with something pending due -> resolve that first, checked BEFORE the
   * gig-posting conversation since a person can be mid-way through
   * posting their own gig (client) while also having a reply due
   * (professional) — a pending reply is short-lived and blocks their own
   * flow until resolved, rather than the two interleaving. Priority order
   * for what "pending" means: a direct invite (Phase 3, one named
   * professional) before a broadcast candidacy (Phase 4, many
   * professionals racing for one gig) — a personal invite is the more
   * specific ask if someone is somehow both. Otherwise -> the guided
   * gig-posting conversation (Phase 2/3.1). See PLAN.md "WhatsApp
   * integration" for what's still deferred past this.
   */
  private async handleText(phone: string, text: string): Promise<void> {
    const user = await this.identity.findUserByPhone(phone);

    if (!user) {
      await this.whatsapp.sendMessage(
        phone,
        'Welcome to Sorted — every job you complete here builds a track record that unlocks more customers, funding, and business support over time. ' +
          'Sign up to get started: https://sorted.com.ng',
      );
      return;
    }

    const session = await this.prisma.whatsAppSession.findUnique({ where: { phone } });
    if (session?.pendingInviteGigId) {
      await this.invites.handleReply(user, phone, text, session.pendingInviteGigId);
      return;
    }
    if (session?.pendingBroadcastGigId) {
      await this.broadcasts.handleReply(user, phone, text, session.pendingBroadcastGigId);
      return;
    }

    await this.gigConversation.handle(user, phone, text);
  }
}

// Meta Cloud API webhook shapes — only the fields this controller reads.
interface WhatsAppInboundMessage {
  from: string;
  type: string;
  text?: { body: string };
}

interface WhatsAppWebhookPayload {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: WhatsAppInboundMessage[];
      };
    }>;
  }>;
}
