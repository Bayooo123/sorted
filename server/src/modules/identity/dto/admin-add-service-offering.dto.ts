import { IsBoolean, IsOptional } from 'class-validator';

/** Omit acceptingOrders to leave it at the schema default (true) on create, or unchanged on an existing row. */
export class AdminAddServiceOfferingDto {
  @IsOptional()
  @IsBoolean()
  acceptingOrders?: boolean;
}
