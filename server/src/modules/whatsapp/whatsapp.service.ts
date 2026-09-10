import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsAppPort } from './whatsapp.interface';

const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;
const GRAPH_API_VERSION = 'v21.0';

@Injectable()
export class WhatsappService implements WhatsAppPort {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async sendMessage(phone: string, text: string): Promise<void> {
    if (!(await this.isSessionOpen(phone))) {
      // Not a failure — this is the expected outcome for anyone who signed
      // up without ever messaging the bot first. Falls back to whatever
      // other channel (email) already fired; see notifications.service.ts.
      this.logger.warn(`Skipped WhatsApp to ${phone} — outside the 24h session window, no approved template yet`);
      return;
    }

    const credentials = this.credentials();
    if (!credentials) return;

    const response = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${credentials.phoneNumberId}/messages`, {
      method: 'POST',
      headers: this.headers(credentials.token),
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone,
        type: 'text',
        text: { body: text },
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      // Logged, not thrown — same reasoning as notifications.service.ts's
      // email failures: a WhatsApp delivery failure must never fail
      // whatever real action (signup, funding, release) triggered it.
      this.logger.error(`WhatsApp send to ${phone} failed: ${response.status} ${body}`);
    }
  }

  async isSessionOpen(phone: string): Promise<boolean> {
    const session = await this.prisma.whatsAppSession.findUnique({ where: { phone } });
    return !!session && Date.now() - session.lastInboundAt.getTime() < SESSION_WINDOW_MS;
  }

  async sendTemplate(phone: string, templateName: string, languageCode: string, bodyParams: string[]): Promise<boolean> {
    const credentials = this.credentials();
    if (!credentials) return false;

    const response = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${credentials.phoneNumberId}/messages`, {
      method: 'POST',
      headers: this.headers(credentials.token),
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone,
        type: 'template',
        template: {
          name: templateName,
          language: { code: languageCode },
          components: [{ type: 'body', parameters: bodyParams.map((text) => ({ type: 'text', text })) }],
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      // Most common cause here: the template named by templateName isn't
      // APPROVED yet in Meta's WhatsApp Manager — that's a config/external-
      // review issue, not a code bug, but still worth a clear log line to
      // save someone re-reading this file to find out why.
      this.logger.error(`WhatsApp template "${templateName}" send to ${phone} failed: ${response.status} ${body}`);
      return false;
    }
    return true;
  }

  async offerReassignment(clientPhone: string, gigId: string, reasonText: string): Promise<void> {
    await this.prisma.whatsAppSession.upsert({
      where: { phone: clientPhone },
      create: { phone: clientPhone, conversationState: 'awaiting_reassignment', reassignGigId: gigId },
      update: { conversationState: 'awaiting_reassignment', reassignGigId: gigId },
    });
    await this.sendMessage(
      clientPhone,
      `${reasonText}\n\nReply with a new WhatsApp number to invite someone else, or reply OPEN to make this job available to any matching professional.`,
    );
  }

  async recordInboundMessage(phone: string): Promise<void> {
    await this.prisma.whatsAppSession.upsert({
      where: { phone },
      create: { phone },
      update: { lastInboundAt: new Date() },
    });
  }

  private credentials(): { token: string; phoneNumberId: string } | null {
    const token = this.config.get<string>('WHATSAPP_TOKEN');
    const phoneNumberId = this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID');
    if (!token || !phoneNumberId) {
      this.logger.error('WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID not set — see server/.env.example');
      return null;
    }
    return { token, phoneNumberId };
  }

  private headers(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  }
}
