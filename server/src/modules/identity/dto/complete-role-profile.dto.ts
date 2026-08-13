import { ArrayUnique, IsArray, IsIn, IsOptional, IsString } from 'class-validator';
import { Role } from '../identity.interface';

export class CompleteRoleProfileDto {
  @IsArray()
  @ArrayUnique()
  @IsIn(['payer', 'solver'], { each: true })
  roles!: Role[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serviceOfferingSubmarketIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  seekingCategorySubmarketIds?: string[];
}
