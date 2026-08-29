import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PAYMENTS_PROVIDER } from './payments.interface';
import { MonnifyProvider } from './providers/monnify.provider';
import { ManualPilotProvider } from './providers/manual-pilot.provider';

/**
 * Binds the active PaymentsProvider behind the PAYMENTS_PROVIDER token,
 * chosen by PAYMENTS_PROVIDER_KEY (default 'manual_pilot' — Monnify
 * onboarding hasn't happened yet, see manual-pilot.provider.ts). A second
 * provider (§8: procurement/government funding, or just "real Monnify
 * once it's ready") is exactly this: a new class plus this one binding —
 * Escrow never changes.
 */
@Module({
  imports: [ConfigModule],
  providers: [
    MonnifyProvider,
    ManualPilotProvider,
    {
      provide: PAYMENTS_PROVIDER,
      inject: [ConfigService, MonnifyProvider, ManualPilotProvider],
      useFactory: (config: ConfigService, monnify: MonnifyProvider, manualPilot: ManualPilotProvider) => {
        const key = config.get<string>('PAYMENTS_PROVIDER_KEY') ?? 'manual_pilot';
        return key === 'monnify' ? monnify : manualPilot;
      },
    },
  ],
  exports: [PAYMENTS_PROVIDER],
})
export class PaymentsModule {}
