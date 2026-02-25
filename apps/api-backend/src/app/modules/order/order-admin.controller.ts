import { Controller, Get, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { OrderService } from './order.service';
import { RejectOrderDto } from './dto/reject-order.dto';
import { OrderQueryDto } from './dto/order-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.VENDOR_ADMIN, UserRole.SUPER_ADMIN)
export class OrderAdminController {
  constructor(private readonly orderService: OrderService) {}

  @Get()
  findAll(@CurrentUser() user: any, @Query() query: OrderQueryDto) {
    return this.orderService.getVendorOrders(user.vendorId, query);
  }

  @Patch(':id/approve')
  approve(@CurrentUser() user: any, @Param('id') id: string) {
    return this.orderService.approveOrder(user.vendorId, id, user.userId);
  }

  @Patch(':id/reject')
  reject(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: RejectOrderDto) {
    return this.orderService.rejectOrder(user.vendorId, id, user.userId, dto);
  }
}
