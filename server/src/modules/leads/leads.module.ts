import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth/auth.module';
import { LeadsAdminController } from './leads-admin.controller';
import { LeadsService } from './leads.service';

/** Exports LeadsService for WhatsappGigConversationService (WhatsappWebhookModule). Imports AuthModule for AdminGuard (LeadsAdminController) — JwtService, since AdminGuard now verifies admin login tokens too. */
@Module({
  imports: [AuthModule],
  controllers: [LeadsAdminController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
