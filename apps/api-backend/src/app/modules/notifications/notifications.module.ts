import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '@water-supply-crm/queue';
import { NotificationService } from './notification.service';
import { NotificationProcessor } from './notification.processor';
import { NotificationLogService } from './notification-log.service';
import { InAppNotificationService } from './in-app-notification.service';
import { NotificationPreferenceService } from './notification-preference.service';
import { NotificationAdminController } from './notification-admin.controller';
import { NotificationPortalController } from './notification-portal.controller';
import { NotificationPreferencesController } from './notification-preferences.controller';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { FcmModule } from '../fcm/fcm.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_NAMES.NOTIFICATIONS }),
    WhatsAppModule,
    FcmModule,
  ],
  controllers: [
    NotificationAdminController,
    NotificationPortalController,
    NotificationPreferencesController,
  ],
  providers: [
    NotificationService,
    NotificationProcessor,
    NotificationLogService,
    InAppNotificationService,
    NotificationPreferenceService,
  ],
  exports: [NotificationService, InAppNotificationService],
})
export class NotificationsModule {}
