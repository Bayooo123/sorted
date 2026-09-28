import { IsString, Length, MinLength } from 'class-validator';

export class AdminChangePasswordDto {
  @IsString()
  @Length(1, 200)
  currentPassword!: string;

  @IsString()
  @MinLength(12)
  newPassword!: string;
}
