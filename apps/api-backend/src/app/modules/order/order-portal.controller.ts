import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { OrderService } from './order.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderQueryDto } from './dto/order-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('portal/orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.CUSTOMER)
export class OrderPortalController {
  constructor(private readonly orderService: OrderService) {}

  @Post()
  create(@CurrentUser() user: any, @Body() dto: CreateOrderDto) {
    return this.orderService.createOrder(user.userId, dto);
  }

  @Get()
  findAll(@CurrentUser() user: any, @Query() query: OrderQueryDto) {
    return this.orderService.getCustomerOrders(user.userId, query);
  }

  @Delete(':id')
  cancel(@CurrentUser() user: any, @Param('id') id: string) {
    return this.orderService.cancelOrder(user.userId, id);
  }
}
