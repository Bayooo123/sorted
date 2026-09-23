import { IsOptional, IsString, Length } from 'class-validator';

/** Public beacon body — see SiteEventsController.recordPageview. */
export class RecordPageviewDto {
  @IsOptional()
  @IsString()
  @Length(0, 500)
  path?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  referrer?: string;
}
