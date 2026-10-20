import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min, ValidateNested } from 'class-validator';

export class PurposeScheduleDto {
  @IsInt()
  @Min(1)
  @Max(90)
  tranches!: number;

  @IsInt()
  @Min(1)
  @Max(90)
  intervalDays!: number;
}

export class AllocatePurposeDto {
  @IsInt()
  @Min(1)
  amountKobo!: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => PurposeScheduleDto)
  schedule?: PurposeScheduleDto;
}
