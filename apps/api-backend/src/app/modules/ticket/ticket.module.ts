import { Module } from '@nestjs/common';
import { TicketService } from './ticket.service';
import { TicketPortalController } from './ticket-portal.controller';
import { TicketAdminController } from './ticket-admin.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { FcmModule } from '../fcm/fcm.module';
import { StorageModule } from '../../common/storage/storage.module';

@Module({
  imports: [NotificationsModule, FcmModule, StorageModule],
  controllers: [TicketPortalController, TicketAdminController],
  providers: [TicketService],
})
export class TicketModule {}
