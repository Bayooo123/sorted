import { IsEmail, IsOptional, Matches } from 'class-validator';

/**
 * Exactly one of phone/email required — checked in IdentityService, not
 * here. class-validator's decorators validate shape per-field, not the
 * "exactly one of two optional fields" relationship between them, so
 * both stay @IsOptional and the service throws BadRequestException on
 * zero or both.
 */
export class RequestOtpDto {
  // Permissive E.164-ish check — Nigeria-focused (+234...) but not hardcoded
  // to it, since HANDOFF.md §8 lists "new cities/currencies" as a config
  // seam, not a hardcoded assumption.
  @IsOptional()
  @Matches(/^\+?[1-9]\d{7,14}$/, { message: 'phone must be a valid E.164-style number' })
  phone?: string;

  @IsOptional()
  @IsEmail({}, { message: 'email must be a valid email address' })
  email?: string;
}
