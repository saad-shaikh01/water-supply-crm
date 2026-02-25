import { Module } from '@nestjs/common';
import { TicketService } from './ticket.service';
import { TicketPortalController } from './ticket-portal.controller';
import { TicketAdminController } from './ticket-admin.controller';

@Module({
  controllers: [TicketPortalController, TicketAdminController],
  providers: [TicketService],
})
export class TicketModule {}
