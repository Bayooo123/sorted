import { IsInt, Min } from 'class-validator';

export class AllocatePurposeDto {
  @IsInt()
  @Min(1)
  amountKobo!: number;
}
