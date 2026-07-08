import { Controller, Get, Patch, Body, Param, Query } from '@nestjs/common';
import { TicketService } from './ticket.service';
import { ReplyTicketDto } from './dto/reply-ticket.dto';
import { TicketQueryDto } from './dto/ticket-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

@Controller('tickets')
export class TicketAdminController {
  constructor(private readonly ticketService: TicketService) {}

  @Get()
  @RequirePermissions('tickets:view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: TicketQueryDto) {
    return this.ticketService.getVendorTickets(user.vendorId, query);
  }

  @Patch(':id/reply')
  @RequirePermissions('tickets:reply')
  reply(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReplyTicketDto) {
    return this.ticketService.replyToTicket(user.vendorId, id, user.userId, dto);
  }
}
