import { IsIn } from 'class-validator';
import { LeadStatus } from '../leads.interface';

export class UpdateLeadStatusDto {
  @IsIn(['new', 'contacted', 'converted', 'closed'])
  status!: LeadStatus;
}
