import { Module, Global } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { TransactionController } from './transaction.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Global()
@Module({
  imports: [NotificationsModule],
  controllers: [TransactionController],
  providers: [LedgerService],
  exports: [LedgerService],
})
export class TransactionModule {}
