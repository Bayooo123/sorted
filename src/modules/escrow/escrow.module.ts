import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { LedgerModule } from '../ledger/ledger.module';
import { EscrowService } from './escrow.service';

@Module({
  imports: [PaymentsModule, LedgerModule],
  providers: [EscrowService],
  exports: [EscrowService],
})
export class EscrowModule {}
