import { IsString, Length } from 'class-validator';

export class SubmitIdentityDto {
  @IsString()
  @Length(1, 200)
  firstName!: string;

  @IsString()
  @Length(1, 200)
  lastName!: string;

  @IsString()
  @Length(11, 11)
  bvn!: string;
}
