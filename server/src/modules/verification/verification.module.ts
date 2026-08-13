import { Module } from '@nestjs/common';
import { VERIFICATION_STRATEGY } from './verification.interface';
import { PayerSignoffStrategy } from './strategies/payer-signoff.strategy';

@Module({
  providers: [
    PayerSignoffStrategy,
    { provide: VERIFICATION_STRATEGY, useExisting: PayerSignoffStrategy },
  ],
  exports: [VERIFICATION_STRATEGY],
})
export class VerificationModule {}
