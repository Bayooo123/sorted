import { Module } from '@nestjs/common';
import { IdentityService } from './identity.service';
import { IdentityController } from './identity.controller';
import { ReputationNotificationsModule } from '../reputation-notifications/reputation-notifications.module';
import { AuthModule } from '../../common/auth/auth.module';

@Module({
  imports: [ReputationNotificationsModule, AuthModule],
  controllers: [IdentityController],
  providers: [IdentityService],
  exports: [IdentityService],
})
export class IdentityModule {}
