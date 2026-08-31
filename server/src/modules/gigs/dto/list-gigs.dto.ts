import { IsIn, IsOptional, IsString } from 'class-validator';

// Keep in sync with GigStatus in gigs.interface.ts.
const GIG_STATUSES = [
  'draft',
  'escrow_pending',
  'open',
  'claimed',
  'in_progress',
  'submitted',
  'signed_off',
  'disputed',
  'released',
  'refunded',
  'cancelled',
] as const;

export class ListGigsDto {
  @IsOptional()
  @IsString()
  domain?: string;

  @IsOptional()
  @IsString()
  submarket?: string;

  @IsOptional()
  @IsString()
  clientType?: string;

  @IsOptional()
  @IsIn(GIG_STATUSES)
  status?: (typeof GIG_STATUSES)[number];
}
