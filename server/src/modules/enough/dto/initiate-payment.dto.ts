import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Matches, Min, ValidateIf, ValidateNested } from 'class-validator';

export class PaymentSourceDto {
  @IsIn(['landing_spot', 'purpose'])
  type!: 'landing_spot' | 'purpose';

  @ValidateIf((o) => o.type === 'purpose')
  @IsString()
  purposeId?: string;
}

export class InitiatePaymentDto {
  @ValidateNested()
  @Type(() => PaymentSourceDto)
  source!: PaymentSourceDto;

  @IsInt()
  @Min(1)
  amountKobo!: number;

  @IsString()
  @Length(1, 20)
  bankCode!: string;

  @IsString()
  @Length(4, 20)
  accountNumber!: string;

  @IsString()
  @Matches(/^\d{4}$/, { message: 'pin must be exactly 4 digits' })
  pin!: string;
}
