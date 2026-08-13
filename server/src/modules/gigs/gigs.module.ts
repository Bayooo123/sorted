import { Module } from '@nestjs/common';
import { GigsService } from './gigs.service';
import { GigsController } from './gigs.controller';
import { TaxonomyController } from './taxonomy.controller';
import { IdentityModule } from '../identity/identity.module';
import { MatchingModule } from '../matching/matching.module';
import { AuthModule } from '../../common/auth/auth.module';

// AuthModule is imported directly (not just via IdentityModule) because
// GigsController's own routes need JwtAuthGuard — importing shared auth
// infra transitively through a business module would be the wrong
// dependency direction.
@Module({
  imports: [IdentityModule, MatchingModule, AuthModule],
  controllers: [TaxonomyController, GigsController],
  providers: [GigsService],
  exports: [GigsService],
})
export class GigsModule {}
