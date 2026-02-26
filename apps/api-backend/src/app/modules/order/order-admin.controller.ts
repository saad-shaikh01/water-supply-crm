import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { OrderService } from './order.service';
import { RejectOrderDto } from './dto/reject-order.dto';
import { OrderQueryDto } from './dto/order-query.dto';
import { DispatchPlanDto } from './dto/dispatch-plan.dto';
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

  @Post(':id/dispatch-plan')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 30 } })
  createDispatchPlan(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: DispatchPlanDto,
  ) {
    return this.orderService.createDispatchPlan(user.vendorId, id, dto, user.id);
  }

  @Patch(':id/dispatch-plan')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 30 } })
  updateDispatchPlan(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: DispatchPlanDto,
  ) {
    return this.orderService.updateDispatchPlan(user.vendorId, id, dto, user.id);
  }

  @Post(':id/dispatch-now')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  dispatchNow(@CurrentUser() user: any, @Param('id') id: string) {
    return this.orderService.dispatchNow(user.vendorId, id, user.id);
  }
}
