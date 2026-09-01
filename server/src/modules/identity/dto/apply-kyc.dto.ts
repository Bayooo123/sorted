import { IsOptional, IsString, Length, MinLength } from 'class-validator';

export class ApplyKycDto {
  @IsString()
  @MinLength(50)
  documentBase64!: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  note?: string;
}
