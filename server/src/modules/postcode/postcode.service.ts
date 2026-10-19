import { Inject, Injectable, Logger } from '@nestjs/common';
import { POSTCODE_PROVIDER_PORT, PostcodeProviderPort, ResolvedPostcode } from './postcode.interface';
import { validatePostcodeFormat } from './postcode-format';

/**
 * PLAN.md "NIPOST digital postcode integration" — the only surface
 * GigsService/IdentityService call into this module through. Combines the
 * offline format check (always available, no network) with the best-effort
 * live resolve (needs NIPOST_POSTCODE_API_BASE_URL configured — see
 * NipostPostcodeProvider's doc comment for why that's not wired to a
 * confirmed real endpoint yet).
 */
@Injectable()
export class PostcodeService {
  private readonly logger = new Logger(PostcodeService.name);

  constructor(@Inject(POSTCODE_PROVIDER_PORT) private readonly provider: PostcodeProviderPort) {}

  /**
   * Validates format, then (best-effort) resolves to coordinates. Returns
   * null for a syntactically invalid code OR when live resolution isn't
   * available — callers can't tell those apart from the return value
   * alone, same as every other best-effort provider call in this codebase;
   * check validatePostcodeFormat separately first if you need to show the
   * user why.
   */
  async resolve(rawCode: string): Promise<ResolvedPostcode | null> {
    const report = validatePostcodeFormat(rawCode);
    if (!report.valid) {
      this.logger.warn(`Rejected postcode "${rawCode}": ${report.diagnoses.map((d) => d.message).join('; ')}`);
      return null;
    }
    return this.provider.resolve(rawCode).catch((err) => {
      this.logger.warn(`Postcode resolve failed for "${rawCode}": ${err instanceof Error ? err.message : err}`);
      return null;
    });
  }
}
