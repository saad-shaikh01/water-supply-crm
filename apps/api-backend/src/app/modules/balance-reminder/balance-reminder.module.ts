import { Module } from '@nestjs/common';
import { BalanceReminderService } from './balance-reminder.service';
import { BalanceReminderController } from './balance-reminder.controller';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { StorageModule } from '../../common/storage/storage.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CustomerStatementPdfService } from '../customer/pdf/customer-statement-pdf.service';

@Module({
  imports: [
    WhatsAppModule,
    StorageModule,
    NotificationsModule,
  ],
  controllers: [BalanceReminderController],
  providers: [BalanceReminderService, CustomerStatementPdfService],
  exports: [BalanceReminderService],
})
export class BalanceReminderModule {}
