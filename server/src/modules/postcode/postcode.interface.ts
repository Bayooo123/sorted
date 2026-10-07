/**
 * PLAN.md "NIPOST digital postcode integration" — NIPOST's National Digital
 * Alphanumeric Postcode System (launched 1 Oct 2026): every addressable
 * building gets an 11-character code, e.g. LA-11-W06-TC-10, structured as
 *   State(2 letters) - LGA(2 digits, 01-99) - District(3 alphanumeric)
 *   - Area(2 letters) - Unit(2 digits, 01-99)
 * Grammar confirmed from NIPOST's own launch coverage; the exact lookup/
 * resolve API shape was not — see NipostPostcodeProvider's own comment
 * before relying on resolve() in production.
 */

export interface PostcodeSegmentDiagnosis {
  segment: 'State' | 'LGA' | 'District' | 'Area' | 'BuildingUnit' | 'Length';
  message: string;
}

export interface PostcodeFormatReport {
  valid: boolean;
  /** Empty when valid. */
  diagnoses: PostcodeSegmentDiagnosis[];
}

export interface ResolvedPostcode {
  lat: number;
  lng: number;
  /** 2-letter state code as returned by the provider, e.g. "LA". */
  state: string;
}

/**
 * The only surface other modules call into Postcode through. Mirrors
 * DeliveryProviderPort's shape deliberately: best-effort, never throws,
 * `null` means "couldn't resolve it right now" (not configured, not found,
 * provider error) — callers log and move on, same discipline as every
 * other best-effort integration in this codebase.
 */
export interface PostcodeProviderPort {
  resolve(code: string): Promise<ResolvedPostcode | null>;
}

export const POSTCODE_PROVIDER_PORT = 'POSTCODE_PROVIDER_PORT';
