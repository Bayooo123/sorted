import { Module } from '@nestjs/common';
import { LEDGER_PORT } from './ledger.interface';
import { LedgerService } from './ledger.service';

@Module({
  providers: [LedgerService, { provide: LEDGER_PORT, useExisting: LedgerService }],
  exports: [LEDGER_PORT],
})
export class LedgerModule {}
