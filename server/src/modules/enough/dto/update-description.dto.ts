import { IsString, Length } from 'class-validator';

export class UpdateDescriptionDto {
  @IsString()
  @Length(1, 2000)
  description!: string;
}
