import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { DeliveryService } from './delivery.service';
import { KwikDeliveryService } from './kwik-delivery.service';
import { SortedFleetDeliveryService } from './sorted-fleet-delivery.service';
import { DELIVERY_PROVIDER_PORT, DeliveryProviderPort } from './delivery.interface';

/**
 * PLAN.md "KWIK delivery integration" / "Sorted-owned rider fleet" — a lean
 * leaf module (PrismaModule is @Global, ConfigModule likewise available
 * everywhere), same shape as WhatsappModule/PaymentsModule: safe for
 * GigsModule and EscrowModule to import without creating a cycle, since
 * this module depends on nothing that depends back on either of them.
 *
 * DELIVERY_PROVIDER_KEY picks the active DeliveryProviderPort, same
 * "exactly one provider live at a time" pattern as PAYMENTS_PROVIDER_KEY —
 * defaults to "kwik" so nothing changes until this is explicitly set to
 * "sorted_fleet" in the environment.
 */
@Module({
  imports: [WhatsappModule],
  providers: [
    DeliveryService,
    KwikDeliveryService,
    SortedFleetDeliveryService,
    {
      provide: DELIVERY_PROVIDER_PORT,
      useFactory: (config: ConfigService, kwik: KwikDeliveryService, sortedFleet: SortedFleetDeliveryService): DeliveryProviderPort =>
        config.get<string>('DELIVERY_PROVIDER_KEY') === 'sorted_fleet' ? sortedFleet : kwik,
      inject: [ConfigService, KwikDeliveryService, SortedFleetDeliveryService],
    },
  ],
  exports: [DeliveryService],
})
export class DeliveryModule {}
