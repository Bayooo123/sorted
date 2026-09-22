import { IsString } from 'class-validator';

/** Category-only filtering for v1 — see PLAN.md "Professional directory". */
export class ListProfessionalsDto {
  @IsString()
  submarket!: string;
}
