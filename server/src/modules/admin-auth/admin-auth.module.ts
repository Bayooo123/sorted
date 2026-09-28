import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth/auth.module';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';

/** Needs AuthModule for JwtService (signing tokens) and AdminGuard (protecting PATCH /admin/password) — PrismaService comes for free, PrismaModule is @Global. */
@Module({
  imports: [AuthModule],
  controllers: [AdminAuthController],
  providers: [AdminAuthService],
})
export class AdminAuthModule {}
