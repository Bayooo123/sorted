import { Module } from '@nestjs/common';
import { PAYMENTS_PROVIDER } from './payments.interface';
import { MonnifyProvider } from './providers/monnify.provider';

/**
 * Binds the active PaymentsProvider behind the PAYMENTS_PROVIDER token. A
 * second provider (§8: procurement/government funding) is a new class plus
 * a change to this one binding — Escrow never changes.
 */
@Module({
  providers: [MonnifyProvider, { provide: PAYMENTS_PROVIDER, useExisting: MonnifyProvider }],
  exports: [PAYMENTS_PROVIDER],
})
export class PaymentsModule {}
