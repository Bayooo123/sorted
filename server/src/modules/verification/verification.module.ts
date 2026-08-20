import { Module } from '@nestjs/common';
import { VERIFICATION_STRATEGY } from './verification.interface';
import { ClientSignoffStrategy } from './strategies/client-signoff.strategy';

@Module({
  providers: [
    ClientSignoffStrategy,
    { provide: VERIFICATION_STRATEGY, useExisting: ClientSignoffStrategy },
  ],
  exports: [VERIFICATION_STRATEGY],
})
export class VerificationModule {}
