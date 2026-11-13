import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '@water-supply-crm/queue';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AnnouncementController } from './announcement.controller';
import { AnnouncementService } from './announcement.service';
import { AnnouncementDispatchService } from './announcement-dispatch.service';
import { AnnouncementProcessor } from './announcement.processor';

/** Phase 4 / Track C — platform announcements delivered through the in-app notification feed. */
@Module({
  imports: [AuditModule, NotificationsModule, BullModule.registerQueue({ name: QUEUE_NAMES.ANNOUNCEMENTS })],
  controllers: [AnnouncementController],
  providers: [AnnouncementService, AnnouncementDispatchService, AnnouncementProcessor],
})
export class AnnouncementsModule {}
