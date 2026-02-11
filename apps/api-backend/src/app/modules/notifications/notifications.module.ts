import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '@water-supply-crm/queue';
import { NotificationService } from './notification.service';
import { NotificationProcessor } from './notification.processor';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.NOTIFICATIONS })],
  providers: [NotificationService, NotificationProcessor],
  exports: [NotificationService],
})
export class NotificationsModule {}
