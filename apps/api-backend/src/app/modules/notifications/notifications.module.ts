import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '@water-supply-crm/queue';
import { NotificationService } from './notification.service';
import { NotificationProcessor } from './notification.processor';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { FcmModule } from '../fcm/fcm.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_NAMES.NOTIFICATIONS }),
    WhatsAppModule,
    FcmModule,
  ],
  providers: [NotificationService, NotificationProcessor],
  exports: [NotificationService],
})
export class NotificationsModule {}
