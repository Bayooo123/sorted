import { IsString, MinLength } from 'class-validator';

/** Format (data URI, size cap) is validated in IdentityService, not here — the cap is a business rule, not a shape rule. */
export class UpdateAvatarDto {
  @IsString()
  @MinLength(50)
  avatarBase64!: string;
}
