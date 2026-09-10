import { Module } from '@nestjs/common';
import { VanCashLedgerService } from './van-cash-ledger.service';
import { VanCashLedgerController } from './van-cash-ledger.controller';
import { AuditModule } from '../audit/audit.module';
import { StorageModule } from '../../common/storage/storage.module';

/**
 * Van Cash Ledger — the "cash in" counterpart to the Expense Center (see
 * VanCashLedgerService's class doc comment). Exports the service so
 * DailySheetModule (close hook) and ExpenseModule (post-close correction
 * hook) can inject it without a module cycle — this module depends on
 * neither of theirs (it reuses ExpenseCenterService's pure domain-utility
 * functions directly, not the ExpenseCenterModule itself).
 */
@Module({
  imports: [AuditModule, StorageModule],
  controllers: [VanCashLedgerController],
  providers: [VanCashLedgerService],
  exports: [VanCashLedgerService],
})
export class VanCashLedgerModule {}
