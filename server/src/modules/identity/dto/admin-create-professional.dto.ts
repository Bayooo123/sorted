import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

/** PLAN.md "Directory order-eligibility gate" — admin-only dummy/display listing. */
export class AdminCreateProfessionalDto {
  @IsString()
  @Length(1, 200)
  displayName!: string;

  @IsString()
  submarketKey!: string;

  @IsOptional()
  @IsBoolean()
  acceptingOrders?: boolean;
}
