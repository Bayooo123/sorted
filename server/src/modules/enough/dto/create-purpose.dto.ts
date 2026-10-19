import { IsString, Length } from 'class-validator';

export class CreatePurposeDto {
  @IsString()
  @Length(1, 100)
  name!: string;
}
