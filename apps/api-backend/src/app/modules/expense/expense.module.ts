import { Module } from '@nestjs/common';
import { ExpenseService } from './expense.service';
import { ExpenseController } from './expense.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  // AuditModule is NOT @Global() (the caching module is) — import it so the
  // Post-Close Expense Correction endpoints can write CLOSED_EXPENSE_* rows.
  imports: [AuditModule],
  controllers: [ExpenseController],
  providers: [ExpenseService],
})
export class ExpenseModule {}
