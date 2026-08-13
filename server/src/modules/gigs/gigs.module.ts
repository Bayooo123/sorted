import { Module } from '@nestjs/common';
import { GigsService } from './gigs.service';

@Module({
  providers: [GigsService],
  exports: [GigsService],
})
export class GigsModule {}
