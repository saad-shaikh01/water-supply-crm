import { Controller, Get, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { TicketService } from './ticket.service';
import { ReplyTicketDto } from './dto/reply-ticket.dto';
import { TicketQueryDto } from './dto/ticket-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('tickets')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.VENDOR_ADMIN, UserRole.SUPER_ADMIN)
export class TicketAdminController {
  constructor(private readonly ticketService: TicketService) {}

  @Get()
  findAll(@CurrentUser() user: any, @Query() query: TicketQueryDto) {
    return this.ticketService.getVendorTickets(user.vendorId, query);
  }

  @Patch(':id/reply')
  reply(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: ReplyTicketDto) {
    return this.ticketService.replyToTicket(user.vendorId, id, user.userId, dto);
  }
}
