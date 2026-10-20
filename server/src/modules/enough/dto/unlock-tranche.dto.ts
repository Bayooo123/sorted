import { IsString, Matches } from 'class-validator';

export class UnlockTrancheDto {
  @IsString()
  @Matches(/^\d{4}$/, { message: 'pin must be exactly 4 digits' })
  pin!: string;
}
