import { IsIn } from 'class-validator';

export class ResolveDisputeDto {
  @IsIn(['for_professional', 'for_client', 'split'])
  ruling!: 'for_professional' | 'for_client' | 'split';
}
