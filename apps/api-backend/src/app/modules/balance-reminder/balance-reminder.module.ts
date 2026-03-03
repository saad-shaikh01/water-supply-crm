import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '@water-supply-crm/queue';
import { BalanceReminderService } from './balance-reminder.service';
import { BalanceReminderProcessor } from './balance-reminder.processor';
import { BalanceReminderController } from './balance-reminder.controller';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { StorageModule } from '../../common/storage/storage.module';
import { CustomerStatementPdfService } from '../customer/pdf/customer-statement-pdf.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_NAMES.BALANCE_REMINDERS }),
    WhatsAppModule,
    StorageModule,
  ],
  controllers: [BalanceReminderController],
  providers: [BalanceReminderService, BalanceReminderProcessor, CustomerStatementPdfService],
  exports: [BalanceReminderService],
})
export class BalanceReminderModule {}
