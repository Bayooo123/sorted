import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth/auth.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { RiderService } from './rider.service';
import { RiderController } from './rider.controller';

/**
 * PLAN.md "Sorted-owned rider fleet" — a leaf module, same shape as
 * WhatsappModule/DeliveryModule: no dependency on GigsModule/IdentityModule,
 * reads Gig/Claim/User directly via the (global) PrismaService instead, same
 * precedent as DeliveryService's own doc comment on why that's fine for a
 * leaf module. Deliberately has NO dependency on DeliveryModule either —
 * the two only share state through the DB (DeliveryTask, RiderProfile), not
 * through a service import, so this module and DeliveryModule stay a clean
 * DAG even though DeliveryModule's SortedFleetDeliveryService writes the
 * rows this module reads.
 */
@Module({
  imports: [AuthModule, WhatsappModule],
  controllers: [RiderController],
  providers: [RiderService],
  exports: [RiderService],
})
export class RiderModule {}
