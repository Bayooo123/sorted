import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth/auth.module';
import { WhatsappService } from './whatsapp.service';
import { WhatsappAdminController } from './whatsapp-admin.controller';
import { WHATSAPP_PORT } from './whatsapp.interface';

/**
 * Deliberately has NO IdentityModule import — see whatsapp.interface.ts's
 * doc comment for why. The inbound webhook lives in WhatsappWebhookModule
 * instead, which imports both this module and IdentityModule.
 * WhatsappAdminController is the one controller here — it only needs the
 * global PrismaService (see its own doc comment) plus AuthModule for
 * AdminGuard's JwtService, neither of which reintroduces that cycle
 * (AuthModule itself has no Identity/Whatsapp dependency).
 */
@Module({
  imports: [AuthModule],
  controllers: [WhatsappAdminController],
  providers: [WhatsappService, { provide: WHATSAPP_PORT, useExisting: WhatsappService }],
  exports: [WHATSAPP_PORT],
})
export class WhatsappModule {}
