import { IsBoolean } from 'class-validator';

export class AdminSetAcceptingOrdersDto {
  @IsBoolean()
  acceptingOrders!: boolean;
}
