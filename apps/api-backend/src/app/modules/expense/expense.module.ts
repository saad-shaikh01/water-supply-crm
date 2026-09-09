import { Module } from '@nestjs/common';
import { ExpenseService } from './expense.service';
import { ExpenseController } from './expense.controller';
import { AuditModule } from '../audit/audit.module';
import { VanCashLedgerModule } from '../van-cash-ledger/van-cash-ledger.module';

@Module({
  // AuditModule is NOT @Global() (the caching module is) — import it so the
  // Post-Close Expense Correction endpoints can write CLOSED_EXPENSE_* rows.
  // VanCashLedgerModule — the Post-Close Expense Correction methods
  // (correctClosed/voidClosed/createClosed) call VanCashLedgerService.
  // handlePostCloseCorrection() inside their own transaction (Van Cash Ledger
  // hook #2, see that service's class doc comment).
  imports: [AuditModule, VanCashLedgerModule],
  controllers: [ExpenseController],
  providers: [ExpenseService],
})
export class ExpenseModule {}
