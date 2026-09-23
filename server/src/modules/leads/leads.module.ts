import { Module } from '@nestjs/common';
import { LeadsAdminController } from './leads-admin.controller';
import { LeadsService } from './leads.service';

/** Exports LeadsService for WhatsappGigConversationService (WhatsappWebhookModule) — only needs the global PrismaService otherwise. */
@Module({
  controllers: [LeadsAdminController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
