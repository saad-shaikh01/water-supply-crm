import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '@water-supply-crm/queue';
import { PaymentReminderService } from './payment-reminder.service';
import { PaymentReminderProcessor } from './payment-reminder.processor';
import { FcmModule } from '../fcm/fcm.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_NAMES.PAYMENT_REMINDERS }),
    FcmModule,
  ],
  providers: [PaymentReminderService, PaymentReminderProcessor],
})
export class PaymentReminderModule {}
