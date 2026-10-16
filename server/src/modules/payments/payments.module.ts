import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PAYMENTS_PROVIDER } from './payments.interface';
import { PaystackProvider } from './providers/paystack.provider';
import { ManualPilotProvider } from './providers/manual-pilot.provider';
import { BachsProvider } from './providers/bachs.provider';

/**
 * Binds the active PaymentsProvider behind the PAYMENTS_PROVIDER token,
 * chosen by PAYMENTS_PROVIDER_KEY (default 'manual_pilot' until real
 * Paystack credentials are set — see manual-pilot.provider.ts). A future
 * second/replacement provider is exactly this: a new class plus this one
 * binding — Escrow never changes. (Monnify was the original plan; dropped
 * before its business KYC finished — see PLAN.md "Paystack integration".
 * Bachs added the same way — see PLAN.md "Bachs payment integration".)
 */
@Module({
  imports: [ConfigModule],
  providers: [
    PaystackProvider,
    ManualPilotProvider,
    BachsProvider,
    {
      provide: PAYMENTS_PROVIDER,
      inject: [ConfigService, PaystackProvider, ManualPilotProvider, BachsProvider],
      useFactory: (config: ConfigService, paystack: PaystackProvider, manualPilot: ManualPilotProvider, bachs: BachsProvider) => {
        const key = config.get<string>('PAYMENTS_PROVIDER_KEY') ?? 'manual_pilot';
        if (key === 'paystack') return paystack;
        if (key === 'bachs') return bachs;
        return manualPilot;
      },
    },
  ],
  exports: [PAYMENTS_PROVIDER],
})
export class PaymentsModule {}
