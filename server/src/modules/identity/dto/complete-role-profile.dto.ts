import { Type } from 'class-transformer';
import { ArrayMinSize, ArrayUnique, IsArray, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';
import { AccountType, Role } from '../identity.interface';

/** PLAN.md "Individual vs business accounts" — required in full when accountType is 'business'. */
class BusinessProfileDto {
  @IsString()
  companyRegistrationNumber!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  directorNames!: string[];

  @IsString()
  businessEmail!: string;

  @IsString()
  businessPhone!: string;

  @IsString()
  businessAddress!: string;
}

export class CompleteRoleProfileDto {
  @IsArray()
  @ArrayUnique()
  @IsIn(['client', 'professional'], { each: true })
  roles!: Role[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serviceOfferingSubmarketIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  seekingCategorySubmarketIds?: string[];

  /** Omit to leave the account's current accountType unchanged — see identity.interface.ts's CompleteRoleProfileInput doc comment. */
  @IsOptional()
  @IsIn(['individual', 'business'])
  accountType?: AccountType;

  @IsOptional()
  @ValidateNested()
  @Type(() => BusinessProfileDto)
  businessProfile?: BusinessProfileDto;
}
