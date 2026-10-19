import { IsOptional, IsString, Matches } from 'class-validator';

export class SetTransactionPinDto {
  @IsString()
  @Matches(/^\d{4}$/, { message: 'pin must be exactly 4 digits' })
  pin!: string;

  /** Required only when changing an existing PIN — omit on first-time setup. */
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}$/, { message: 'currentPin must be exactly 4 digits' })
  currentPin?: string;
}
