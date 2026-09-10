import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class RateGigDto {
  @IsInt()
  @Min(1)
  @Max(5)
  stars!: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
