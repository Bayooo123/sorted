import { Module } from '@nestjs/common';
import { EscrowModule } from '../escrow/escrow.module';
import { DisputesService } from './disputes.service';

@Module({
  imports: [EscrowModule],
  providers: [DisputesService],
  exports: [DisputesService],
})
export class DisputesModule {}
