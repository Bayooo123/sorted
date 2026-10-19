import { Module } from '@nestjs/common';
import { PostcodeService } from './postcode.service';
import { NipostPostcodeProvider } from './nipost-postcode.provider';
import { POSTCODE_PROVIDER_PORT } from './postcode.interface';

/**
 * PLAN.md "NIPOST digital postcode integration" — a lean leaf module, same
 * shape as DeliveryModule/PaymentsModule: safe for GigsModule and
 * IdentityModule to both import without creating a cycle.
 */
@Module({
  providers: [PostcodeService, { provide: POSTCODE_PROVIDER_PORT, useClass: NipostPostcodeProvider }],
  exports: [PostcodeService],
})
export class PostcodeModule {}
