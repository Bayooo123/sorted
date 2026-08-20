import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';

class LocationGeoDto {
  @IsNumber()
  lat!: number;

  @IsNumber()
  lng!: number;
}

export class CreateGigDto {
  @IsString()
  @Length(3, 200)
  title!: string;

  @IsString()
  @Length(1, 5000)
  description!: string;

  /** Taxonomy `key`, e.g. "physical" — resolved to an id in GigsService. */
  @IsString()
  domain!: string;

  /** Taxonomy `key`, e.g. "plumbing". */
  @IsString()
  submarket!: string;

  /** Taxonomy `key`, e.g. "individual". */
  @IsString()
  clientType!: string;

  @IsString()
  @Length(1, 500)
  locationText!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => LocationGeoDto)
  locationGeo?: LocationGeoDto;

  @IsIn(['bounty_covers', 'professional_supplies'])
  materialsMode!: 'bounty_covers' | 'professional_supplies';

  @IsInt()
  @Min(1)
  bountyKobo!: number;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  criteria!: string[];

  @IsOptional()
  @IsString()
  templateId?: string;
}
