import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { IdentityService } from './identity.service';
import { IdentityController } from './identity.controller';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { ReputationNotificationsModule } from '../reputation-notifications/reputation-notifications.module';

@Module({
  imports: [
    ReputationNotificationsModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN') ?? '30d' },
      }),
    }),
  ],
  controllers: [IdentityController],
  providers: [IdentityService, JwtAuthGuard],
  exports: [IdentityService],
})
export class IdentityModule {}
