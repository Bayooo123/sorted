import { IsString, Length } from 'class-validator';

export class ResolveAccountDto {
  @IsString()
  @Length(1, 20)
  bankCode!: string;

  @IsString()
  @Length(4, 20)
  accountNumber!: string;
}
