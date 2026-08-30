import { IsEmail, IsIn, IsString, Length, Matches } from 'class-validator';
import { NIGERIAN_STATES } from '../../../common/nigerian-states';

export class SignupDto {
  @IsEmail({}, { message: 'email must be a valid email address' })
  email!: string;

  // Permissive E.164-ish check — Nigeria-focused (+234...) but not hardcoded
  // to it, since HANDOFF.md §8 lists "new cities/currencies" as a config
  // seam, not a hardcoded assumption.
  @Matches(/^\+?[1-9]\d{7,14}$/, { message: 'phone must be a valid E.164-style number' })
  phone!: string;

  @IsString()
  @Length(1, 200)
  name!: string;

  @IsIn(NIGERIAN_STATES)
  state!: string;

  @IsString()
  @Length(8, 200, { message: 'password must be at least 8 characters' })
  password!: string;
}
