import { IsIn, IsOptional, IsString, Length } from 'class-validator';

export class ReviewKycDto {
  @IsIn(['approved', 'rejected'])
  decision!: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  @Length(0, 500)
  reviewNote?: string;
}
