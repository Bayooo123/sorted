import { Module } from '@nestjs/common';
import { GigsModule } from '../gigs/gigs.module';
import { AuthModule } from '../../common/auth/auth.module';
import { RatingsService } from './ratings.service';
import { RatingsController } from './ratings.controller';

@Module({
  imports: [GigsModule, AuthModule],
  controllers: [RatingsController],
  providers: [RatingsService],
  exports: [RatingsService],
})
export class RatingsModule {}
