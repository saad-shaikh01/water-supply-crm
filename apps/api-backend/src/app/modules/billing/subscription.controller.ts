import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import type { AuthUser } from '@water-supply-crm/types';
import { RequireRoles, RequireSuperAdmin } from '../../common/decorators/authz-markers.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { SubscriptionService } from './subscription.service';
import { AssignSubscriptionDto, CancelSubscriptionDto, ListSubscriptionsQueryDto } from './dto/subscription.dto';

// Platform surface — super-admin only.
@Controller('platform')
@RequireSuperAdmin()
export class PlatformSubscriptionController {
  constructor(private readonly subscriptions: SubscriptionService) {}

  @Get('subscriptions')
  list(@Query() query: ListSubscriptionsQueryDto) {
    return this.subscriptions.list(query);
  }

  @Get('vendors/:vendorId/subscription')
  get(@Param('vendorId', ParseUUIDPipe) vendorId: string) {
    return this.subscriptions.getForVendor(vendorId);
  }

  @Put('vendors/:vendorId/subscription')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 20 } })
  assign(
    @CurrentUser() user: AuthUser,
    @Param('vendorId', ParseUUIDPipe) vendorId: string,
    @Body() dto: AssignSubscriptionDto,
  ) {
    return this.subscriptions.assign(vendorId, dto, user);
  }

  @Post('vendors/:vendorId/subscription/cancel')
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('vendorId', ParseUUIDPipe) vendorId: string,
    @Body() dto: CancelSubscriptionDto,
  ) {
    return this.subscriptions.cancel(vendorId, dto, user);
  }

  @Post('vendors/:vendorId/subscription/reactivate')
  reactivate(@CurrentUser() user: AuthUser, @Param('vendorId', ParseUUIDPipe) vendorId: string) {
    return this.subscriptions.reactivate(vendorId, user);
  }
}

// Vendor self-view — tenant comes from the token, never from the URL.
@Controller('subscription/me')
@RequireRoles(UserRole.VENDOR_ADMIN)
export class SubscriptionMeController {
  constructor(private readonly subscriptions: SubscriptionService) {}

  @Get()
  getMine(@CurrentUser() user: AuthUser) {
    return this.subscriptions.getMine(user.vendorId);
  }

  @Get('invoices')
  getMyInvoices(@CurrentUser() user: AuthUser, @Query() query: PaginationQueryDto) {
    return this.subscriptions.getMyInvoices(user.vendorId, query);
  }
}
