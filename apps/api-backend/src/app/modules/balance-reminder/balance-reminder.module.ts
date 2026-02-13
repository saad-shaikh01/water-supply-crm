import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '@water-supply-crm/queue';
import { BalanceReminderService } from './balance-reminder.service';
import { BalanceReminderProcessor } from './balance-reminder.processor';
import { BalanceReminderController } from './balance-reminder.controller';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_NAMES.BALANCE_REMINDERS }),
    WhatsAppModule,
  ],
  controllers: [BalanceReminderController],
  providers: [BalanceReminderService, BalanceReminderProcessor],
  exports: [BalanceReminderService],
})
export class BalanceReminderModule {}
