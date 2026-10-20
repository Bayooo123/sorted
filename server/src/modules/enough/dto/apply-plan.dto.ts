import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsInt, IsString, Length, Max, Min, ValidateNested } from 'class-validator';

export class PlanPurposeDto {
  @IsString()
  @Length(1, 100)
  name!: string;

  @IsInt()
  @Min(1)
  @Max(100)
  targetPercent!: number;
}

export class ApplyPlanDto {
  @ValidateNested({ each: true })
  @Type(() => PlanPurposeDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  purposes!: PlanPurposeDto[];
}
