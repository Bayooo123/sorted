import { IsString, Length } from 'class-validator';

export class PayoutDestinationDto {
  @IsString()
  @Length(3, 10)
  bankCode!: string;

  @IsString()
  @Length(10, 10)
  accountNumber!: string;

  @IsString()
  accountName!: string;
}
