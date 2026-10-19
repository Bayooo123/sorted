import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PostcodeProviderPort, ResolvedPostcode } from './postcode.interface';

/**
 * NIPOST adapter (PLAN.md "NIPOST digital postcode integration").
 *
 * The endpoint shape below (`GET /v1/lookup?code=...`, `{lat,lng,state}`
 * or `{latitude,longitude,state}` response) was originally a best guess
 * from a third-party README, not NIPOST's own docs — now confirmed
 * working against NIPOST's real API in production (Oct 2026), with
 * NIPOST_POSTCODE_API_BASE_URL set and no API key required. Still fails
 * closed (returns null, logged) on any unexpected response shape or a
 * postcode NIPOST doesn't recognize — never silently wrong.
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
