import { IsOptional, IsString, MinLength } from 'class-validator';

/** Format (data URI, size cap) is validated in GigsService, not here — the cap is a business rule, not a shape rule. */
export class SubmitForReviewDto {
  @IsString()
  @MinLength(50)
  proofBase64!: string;

  @IsOptional()
  @IsString()
  note?: string;
}
