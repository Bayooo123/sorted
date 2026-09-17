import { Module } from '@nestjs/common';
import { DeliveryService } from './delivery.service';
import { KwikDeliveryService } from './kwik-delivery.service';
import { DELIVERY_PROVIDER_PORT } from './delivery.interface';

/**
 * PLAN.md "KWIK delivery integration" — a lean leaf module (PrismaModule
 * is @Global, ConfigModule likewise available everywhere), same shape as
 * WhatsappModule/PaymentsModule: safe for GigsModule and EscrowModule to
 * import without creating a cycle, since this module depends on nothing
 * that depends back on either of them.
 */
@Module({
  providers: [DeliveryService, { provide: DELIVERY_PROVIDER_PORT, useClass: KwikDeliveryService }],
  exports: [DeliveryService],
})
export class DeliveryModule {}
