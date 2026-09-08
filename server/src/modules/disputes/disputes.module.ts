import { Module } from '@nestjs/common';
import { EscrowModule } from '../escrow/escrow.module';
import { GigsModule } from '../gigs/gigs.module';
import { AuthModule } from '../../common/auth/auth.module';
import { DisputesService } from './disputes.service';
import { DisputesController } from './disputes.controller';

@Module({
  imports: [EscrowModule, GigsModule, AuthModule],
  controllers: [DisputesController],
  providers: [DisputesService],
  exports: [DisputesService],
})
export class DisputesModule {}
