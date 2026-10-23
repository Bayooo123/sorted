import { IsString, Length } from 'class-validator';

export class AdminRenameUserDto {
  @IsString()
  @Length(1, 200)
  displayName!: string;
}
