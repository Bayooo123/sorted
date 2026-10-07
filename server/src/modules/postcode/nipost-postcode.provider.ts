import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PostcodeProviderPort, ResolvedPostcode } from './postcode.interface';

/**
 * NIPOST adapter (PLAN.md "NIPOST digital postcode integration").
 *
 * IMPORTANT — read before relying on this in production, same caveat as
 * KwikDeliveryService's: this was written from a third-party blog post and
 * an unofficial Go client's README describing NIPOST's postcode system,
 * not NIPOST's own API reference — docs.postcode.gov.ng was unreachable
 * from this environment to confirm the real request/response shape.
 *
 * The one thing independently confirmed (government press coverage, not
 * the blog): NIPOST's National Digital Postcode launched 1 Oct 2026 and
 * postcode.gov.ng is the real, official site. The specific path below
 * (`GET /v1/lookup?code=...`) and its response fields are a best guess
 * from that third-party README's mention of a `GET /v1/lookup` endpoint —
 * confirm against NIPOST's real docs and correct via NIPOST_POSTCODE_PATH_LOOKUP
 * before trusting this for real dispatch decisions. Until then this will
 * most likely just fail closed (return null, logged), same as KWIK did
 * before its own credentials were confirmed — never silently wrong.
 */
@Injectable()
export class NipostPostcodeProvider implements PostcodeProviderPort {
  private readonly logger = new Logger(NipostPostcodeProvider.name);

  constructor(private readonly config: ConfigService) {}

  private credentials() {
    const baseUrl = this.config.get<string>('NIPOST_POSTCODE_API_BASE_URL');
    const apiKey = this.config.get<string>('NIPOST_POSTCODE_API_KEY');
    if (!baseUrl) return null;
    return { baseUrl: baseUrl.replace(/\/+$/, ''), apiKey };
  }

  async resolve(code: string): Promise<ResolvedPostcode | null> {
    const creds = this.credentials();
    if (!creds) {
      this.logger.warn('NIPOST_POSTCODE_API_BASE_URL not set — skipping postcode resolution');
      return null;
    }

    const path = this.config.get<string>('NIPOST_POSTCODE_PATH_LOOKUP') || '/v1/lookup';
    try {
      const response = await fetch(`${creds.baseUrl}${path}?code=${encodeURIComponent(code)}`, {
        headers: creds.apiKey ? { 'X-API-Key': creds.apiKey } : undefined,
      });
      if (!response.ok) {
        this.logger.warn(`NIPOST lookup for ${code} failed: ${response.status}`);
        return null;
      }
      const json = (await response.json()) as { lat?: number; lng?: number; latitude?: number; longitude?: number; state?: string };
      const lat = json.lat ?? json.latitude;
      const lng = json.lng ?? json.longitude;
      if (lat == null || lng == null) {
        this.logger.warn(`NIPOST lookup for ${code} returned no coordinates`);
        return null;
      }
      return { lat, lng, state: json.state ?? code.slice(0, 2) };
    } catch (err) {
      this.logger.warn(`NIPOST lookup for ${code} request failed: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }
}
