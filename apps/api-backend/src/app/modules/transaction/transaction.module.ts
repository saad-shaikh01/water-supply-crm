import { Module, Global } from '@nestjs/common';
import { LedgerService } from './ledger.service';

@Global()
@Module({
  providers: [LedgerService],
  exports: [LedgerService],
})
export class TransactionModule {}
