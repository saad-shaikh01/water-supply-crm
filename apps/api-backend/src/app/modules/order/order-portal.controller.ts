import { Controller, Get, Post, Delete, Body, Param, Query } from '@nestjs/common';
import { OrderService } from './order.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderQueryDto } from './dto/order-query.dto';
import { RequireCustomer } from '../../common/decorators/authz-markers.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

@Controller('portal/orders')
@RequireCustomer()
export class OrderPortalController {
  constructor(private readonly orderService: OrderService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrderDto) {
    return this.orderService.createOrder(user.userId, dto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query() query: OrderQueryDto) {
    return this.orderService.getCustomerOrders(user.userId, query);
  }

  @Delete(':id')
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orderService.cancelOrder(user.userId, id);
  }
}
