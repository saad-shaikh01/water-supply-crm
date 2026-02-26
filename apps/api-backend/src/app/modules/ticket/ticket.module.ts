import { Module } from '@nestjs/common';
import { TicketService } from './ticket.service';
import { TicketPortalController } from './ticket-portal.controller';
import { TicketAdminController } from './ticket-admin.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { FcmModule } from '../fcm/fcm.module';

@Module({
  imports: [NotificationsModule, FcmModule],
  controllers: [TicketPortalController, TicketAdminController],
  providers: [TicketService],
})
export class TicketModule {}
