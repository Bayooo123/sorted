import { Matches } from 'class-validator';

export class RequestOtpDto {
  // Permissive E.164-ish check — Nigeria-focused (+234...) but not hardcoded
  // to it, since HANDOFF.md §8 lists "new cities/currencies" as a config
  // seam, not a hardcoded assumption.
  @Matches(/^\+?[1-9]\d{7,14}$/, { message: 'phone must be a valid E.164-style number' })
  phone!: string;
}
