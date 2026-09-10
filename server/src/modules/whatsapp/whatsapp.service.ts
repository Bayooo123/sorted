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
    const session = await this.prisma.whatsAppSession.findUnique({ where: { phone } });
    const withinWindow = !!session && Date.now() - session.lastInboundAt.getTime() < SESSION_WINDOW_MS;

    if (!withinWindow) {
      // Not a failure — this is the expected outcome for anyone who signed
      // up without ever messaging the bot first. Falls back to whatever
      // other channel (email) already fired; see notifications.service.ts.
      this.logger.warn(`Skipped WhatsApp to ${phone} — outside the 24h session window, no approved template yet`);
      return;
    }

    const token = this.config.get<string>('WHATSAPP_TOKEN');
    const phoneNumberId = this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID');
    if (!token || !phoneNumberId) {
      this.logger.error('WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID not set — see server/.env.example');
      return;
    }

    const response = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
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

  async recordInboundMessage(phone: string): Promise<void> {
    await this.prisma.whatsAppSession.upsert({
      where: { phone },
      create: { phone },
      update: { lastInboundAt: new Date() },
    });
  }
}
