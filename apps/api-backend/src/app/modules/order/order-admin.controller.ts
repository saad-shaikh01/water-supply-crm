import { Controller, Get, Post, Patch, Body, Param, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { OrderService } from './order.service';
import { RejectOrderDto } from './dto/reject-order.dto';
import { OrderQueryDto } from './dto/order-query.dto';
import { DispatchPlanDto } from './dto/dispatch-plan.dto';
import { BulkApproveDto, BulkPlanDto } from './dto/bulk-order.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

@Controller('orders')
export class OrderAdminController {
  constructor(private readonly orderService: OrderService) {}

  @Get()
  @RequirePermissions('orders:view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: OrderQueryDto) {
    return this.orderService.getVendorOrders(user.vendorId, query);
  }

  @Patch(':id/approve')
  @RequirePermissions('orders:approve')
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orderService.approveOrder(user.vendorId, id, user.userId);
  }

  @Patch(':id/reject')
  @RequirePermissions('orders:reject')
  reject(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: RejectOrderDto) {
    return this.orderService.rejectOrder(user.vendorId, id, user.userId, dto);
  }

  @Post(':id/dispatch-plan')
  @RequirePermissions('orders:dispatch')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 30 } })
  createDispatchPlan(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: DispatchPlanDto,
  ) {
    return this.orderService.createDispatchPlan(user.vendorId, id, dto, user.userId);
  }

  @Patch(':id/dispatch-plan')
  @RequirePermissions('orders:dispatch')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 30 } })
  updateDispatchPlan(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: DispatchPlanDto,
  ) {
    return this.orderService.updateDispatchPlan(user.vendorId, id, dto, user.userId);
  }

  @Post(':id/dispatch-now')
  @RequirePermissions('orders:dispatch')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  dispatchNow(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orderService.dispatchNow(user.vendorId, id, user.userId);
  }

  @Post('bulk-approve')
  @RequirePermissions('orders:approve')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  bulkApprove(@CurrentUser() user: AuthUser, @Body() dto: BulkApproveDto) {
    return this.orderService.bulkApprove(user.vendorId, dto, user.userId);
  }

  @Post('bulk-plan')
  @RequirePermissions('orders:dispatch')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  bulkPlan(@CurrentUser() user: AuthUser, @Body() dto: BulkPlanDto) {
    return this.orderService.bulkPlan(user.vendorId, dto, user.userId);
  }
}
