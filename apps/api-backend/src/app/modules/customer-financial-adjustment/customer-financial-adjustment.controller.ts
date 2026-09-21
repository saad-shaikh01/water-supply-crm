import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser } from '@water-supply-crm/types';
import { CustomerFinancialAdjustmentService } from './customer-financial-adjustment.service';
import { CreateCustomerFinancialAdjustmentDto } from './dto/create-customer-financial-adjustment.dto';
import { VoidCustomerFinancialAdjustmentDto } from './dto/void-customer-financial-adjustment.dto';
import { ListCustomerFinancialAdjustmentsQueryDto } from './dto/list-customer-financial-adjustments-query.dto';
import {
  RequireAnyPermission,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * Customer Financial Adjustments (owner-approved 2026-09-21).
 *   - POST /customer-financial-adjustments          → post an adjustment (charge, credit,
 *     write-off or correction).
 *   - POST /customer-financial-adjustments/:id/void → void one by posting its reversal
 *     (`customer_financial_adjustments:void`; a reason is mandatory).
 *   - GET  /customer-financial-adjustments          → list (`customer_financial_adjustments:view`).
 *   - GET  /customer-financial-adjustments/:id      → one, with its void chain (`view`).
 *   Static routes (none yet) must be declared BEFORE the dynamic `:id` GET — the NestJS
 *   route-shadowing convention used throughout this codebase.
 *
 * The guard here is deliberately COARSE: "holds at least one of the posting
 * permissions". Which one a request actually needs depends on its `kind`
 * (charge → `create`, credit → `create_credit`), so the exact check is made in
 * CustomerFinancialAdjustmentService.create — a route decorator can't see the body.
 * The three posting tiers: `create` (charges), `create_credit` (credits) and
 * `create_restricted` (write-off / correction). A transfer needs `transfer` and has its
 * own endpoint later, so it is deliberately NOT in this list.
 */
@Controller('customer-financial-adjustments')
export class CustomerFinancialAdjustmentController {
  constructor(private readonly adjustments: CustomerFinancialAdjustmentService) {}

  @Post()
  @RequireAnyPermission(
    'customer_financial_adjustments:create',
    'customer_financial_adjustments:create_credit',
    'customer_financial_adjustments:create_restricted',
  )
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCustomerFinancialAdjustmentDto) {
    return this.adjustments.create(user, dto);
  }

  @Get()
  @RequirePermissions('customer_financial_adjustments:view')
  list(@CurrentUser() user: AuthUser, @Query() query: ListCustomerFinancialAdjustmentsQueryDto) {
    return this.adjustments.list(user.vendorId, query);
  }

  @Get(':id')
  @RequirePermissions('customer_financial_adjustments:view')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.adjustments.get(user.vendorId, id);
  }

  /**
   * Static permission, so the route guard is the whole check here (the service
   * re-asserts it as defence in depth). Fewer, tighter attempts than create — a void
   * is a deliberate, rare correction.
   */
  @Post(':id/void')
  @RequirePermissions('customer_financial_adjustments:void')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  voidAdjustment(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: VoidCustomerFinancialAdjustmentDto,
  ) {
    return this.adjustments.voidAdjustment(user, id, dto);
  }
}
