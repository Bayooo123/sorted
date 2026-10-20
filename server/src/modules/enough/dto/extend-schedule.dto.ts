import { IsInt, Max, Min } from 'class-validator';

export class ExtendScheduleDto {
  @IsInt()
  @Min(1)
  @Max(90)
  intervalDays!: number;
}
