import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth/auth.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

/** Only needs the global PrismaService — reads across tables directly, no cross-module ports (this is an admin read, not product business logic). AuthModule is for AdminGuard's JwtService. */
@Module({
  imports: [AuthModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
