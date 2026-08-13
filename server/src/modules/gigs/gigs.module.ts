import { Module } from '@nestjs/common';
import { GigsService } from './gigs.service';
import { TaxonomyController } from './taxonomy.controller';

@Module({
  controllers: [TaxonomyController],
  providers: [GigsService],
  exports: [GigsService],
})
export class GigsModule {}
