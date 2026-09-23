import { Controller, Get, HttpCode, Post, Query, Res, Body } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { RecordPageviewDto } from './dto/record-pageview.dto';

/** Matches index.html's own hardcoded WHATSAPP_NUMBER — overridable via WHATSAPP_CONTACT_NUMBER without a frontend redeploy. */
const DEFAULT_WHATSAPP_CONTACT_NUMBER = '2349031812675';

/** Strips characters that could break a redirect Location header or bloat the DB column — never throws, this is best-effort logging, not validation the caller needs to satisfy. */
function sanitize(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/[\r\n\0]/g, '').trim();
  return cleaned ? cleaned.slice(0, maxLength) : undefined;
}

/**
 * PLAN.md "Product analytics dashboard" — public, unauthenticated. Two
 * jobs: log a pageview beacon from index.html, and log+redirect a
 * WhatsApp CTA click (every wa.me link on the site routes through here
 * instead of pointing at wa.me directly, so it's actually counted before
 * the browser navigates away).
 *
 * No IdentityModule/AdminGuard involved — this never returns anything
 * sensitive, and the WhatsApp destination is server-configured, never
 * taken from the query string, which is what keeps a public redirect
 * endpoint from being an open redirect.
 */
@Controller()
export class SiteEventsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Post('site-events')
  @HttpCode(204)
  async recordPageview(@Body() dto: RecordPageviewDto): Promise<void> {
    await this.prisma.siteEvent.create({
      data: { type: 'pageview', path: sanitize(dto.path, 500), referrer: sanitize(dto.referrer, 500) },
    });
  }

  @Get('go/whatsapp')
  async redirectToWhatsapp(
    @Query('cta') cta: string | undefined,
    @Query('text') text: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    await this.prisma.siteEvent.create({
      data: { type: 'whatsapp_click', ctaId: sanitize(cta, 100) },
    });

    const number = this.config.get<string>('WHATSAPP_CONTACT_NUMBER') || DEFAULT_WHATSAPP_CONTACT_NUMBER;
    const cleanText = sanitize(text, 1000);
    const url = `https://wa.me/${number}` + (cleanText ? `?text=${encodeURIComponent(cleanText)}` : '');
    res.redirect(302, url);
  }
}
