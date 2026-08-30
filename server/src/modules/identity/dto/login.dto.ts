import { IsString, Length } from 'class-validator';

export class LoginDto {
  /** An email or a phone number — IdentityService.login checks both columns. */
  @IsString()
  @Length(1, 200)
  identifier!: string;

  @IsString()
  @Length(1, 200)
  password!: string;
}
