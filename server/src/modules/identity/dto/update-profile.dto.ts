import { IsOptional, IsString, Length } from 'class-validator';

/** All optional — only fields present are changed. See IdentityService.updateProfile for phone normalization. */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 20)
  phone?: string;

  @IsOptional()
  @IsString()
  state?: string;
}
