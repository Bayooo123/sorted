import { IsString, Length } from 'class-validator';

export class ConfirmReleaseDto {
  /** Whatever the founder used to recognize the transfer/split landing — a bank alert reference, or free text like "opay alert 2:14pm". */
  @IsString()
  @Length(1, 200)
  providerRef!: string;
}
