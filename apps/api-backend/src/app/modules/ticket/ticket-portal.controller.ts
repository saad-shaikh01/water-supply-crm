import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { TicketService } from './ticket.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { TicketQueryDto } from './dto/ticket-query.dto';
import { CreateTicketMessageDto } from './dto/create-ticket-message.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('portal/tickets')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.CUSTOMER)
export class TicketPortalController {
  constructor(private readonly ticketService: TicketService) {}

  @Post()
  create(@CurrentUser() user: any, @Body() dto: CreateTicketDto) {
    return this.ticketService.createTicket(user.userId, dto);
  }

  @Get()
  findAll(@CurrentUser() user: any, @Query() query: TicketQueryDto) {
    return this.ticketService.getCustomerTickets(user.userId, query);
  }

  @Get(':id')
  findOne(@CurrentUser() user: any, @Param('id') id: string) {
    return this.ticketService.getCustomerTicketById(user.userId, id);
  }

  @Get(':id/messages')
  getMessages(@CurrentUser() user: any, @Param('id') id: string) {
    return this.ticketService.getTicketMessages(user.userId, id);
  }

  @Post(':id/messages')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 30 } })
  createMessage(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: CreateTicketMessageDto,
  ) {
    return this.ticketService.createTicketMessage(user.userId, id, dto);
  }
}
