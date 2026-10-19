import { PostcodeFormatReport, PostcodeSegmentDiagnosis } from './postcode.interface';

/**
 * Pure, offline, zero-network grammar check — no state-code dictionary
 * involved, so this never needs NIPOST's API to tell a customer their
 * postcode is syntactically wrong. Deliberately does NOT check whether
 * the 2-letter state code is a REAL Nigerian state (that needs NIPOST's
 * own states list, which this codebase doesn't have a verified copy of
 * yet — see PostcodeService's doc comment) — only shape, length, and the
 * documented "00 is prohibited" rule for LGA/BuildingUnit.
 */
const SEGMENT_LENGTHS = { state: 2, lga: 2, district: 3, area: 2, unit: 2 } as const;
const CANONICAL_LENGTH = 11;

export function validatePostcodeFormat(raw: string): PostcodeFormatReport {
  const code = raw.trim().toUpperCase().replace(/[\s-]+/g, '');
  const diagnoses: PostcodeSegmentDiagnosis[] = [];

  if (code.length !== CANONICAL_LENGTH) {
    diagnoses.push({
      segment: 'Length',
      message: `Postcode must be ${CANONICAL_LENGTH} characters once spaces/dashes are removed (got ${code.length}): State(2) + LGA(2) + District(3) + Area(2) + Unit(2).`,
    });
    return { valid: false, diagnoses };
  }

  const state = code.slice(0, 2);
  const lga = code.slice(2, 4);
  const district = code.slice(4, 7);
  const area = code.slice(7, 9);
  const unit = code.slice(9, 11);

  if (!/^[A-Z]{2}$/.test(state)) {
    diagnoses.push({ segment: 'State', message: `State code "${state}" must be exactly 2 letters.` });
  }
  if (!/^[0-9]{2}$/.test(lga)) {
    diagnoses.push({ segment: 'LGA', message: `LGA code "${lga}" must be exactly 2 digits.` });
  } else if (lga === '00') {
    diagnoses.push({ segment: 'LGA', message: 'LGA code "00" is not a valid LGA — codes run 01-99.' });
  }
  if (!/^[A-Z0-9]{3}$/.test(district)) {
    diagnoses.push({ segment: 'District', message: `District code "${district}" must be exactly 3 alphanumeric characters.` });
  }
  if (!/^[A-Z]{2}$/.test(area)) {
    diagnoses.push({ segment: 'Area', message: `Area code "${area}" must be exactly 2 letters.` });
  }
  if (!/^[0-9]{2}$/.test(unit)) {
    diagnoses.push({ segment: 'BuildingUnit', message: `Building unit "${unit}" must be exactly 2 digits.` });
  } else if (unit === '00') {
    diagnoses.push({ segment: 'BuildingUnit', message: 'Building unit "00" is not valid — unit codes run 01-99.' });
  }

  return { valid: diagnoses.length === 0, diagnoses };
}

/** Canonical "SS-LL-DDD-AA-UU" display form, once format is already confirmed valid. */
export function formatPostcode(raw: string): string {
  const code = raw.trim().toUpperCase().replace(/[\s-]+/g, '');
  return `${code.slice(0, 2)}-${code.slice(2, 4)}-${code.slice(4, 7)}-${code.slice(7, 9)}-${code.slice(9, 11)}`;
}
