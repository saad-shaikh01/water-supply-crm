import { Module, Global } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { TransactionController } from './transaction.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditModule } from '../audit/audit.module';

@Global()
@Module({
  imports: [NotificationsModule, AuditModule],
  controllers: [TransactionController],
  providers: [LedgerService],
  exports: [LedgerService],
})
export class TransactionModule {}
