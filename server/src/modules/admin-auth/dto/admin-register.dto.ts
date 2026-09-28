import { IsString, Length, MinLength } from 'class-validator';

export class AdminRegisterDto {
  @IsString()
  @Length(1, 100)
  username!: string;

  @IsString()
  @MinLength(12)
  password!: string;
}
