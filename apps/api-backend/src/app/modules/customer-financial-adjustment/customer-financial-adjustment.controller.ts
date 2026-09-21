import { Body, Controller, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser } from '@water-supply-crm/types';
import { CustomerFinancialAdjustmentService } from './customer-financial-adjustment.service';
import { CreateCustomerFinancialAdjustmentDto } from './dto/create-customer-financial-adjustment.dto';
import { VoidCustomerFinancialAdjustmentDto } from './dto/void-customer-financial-adjustment.dto';
import {
  RequireAnyPermission,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * Customer Financial Adjustments (owner-approved 2026-09-21).
 *   - POST /customer-financial-adjustments          → post a charge or credit.
 *   - POST /customer-financial-adjustments/:id/void → void one by posting its reversal
 *     (`customer_financial_adjustments:void`; a reason is mandatory).
 *
 * The guard here is deliberately COARSE: "holds at least one of the posting
 * permissions". Which one a request actually needs depends on its `kind`
 * (charge → `create`, credit → `create_credit`), so the exact check is made in
 * CustomerFinancialAdjustmentService.create — a route decorator can't see the body.
 * Phase 2A lists only the two tiers it can post; `create_restricted` (write-off /
 * correction) joins in a later slice together with those kinds.
 */
@Controller('customer-financial-adjustments')
export class CustomerFinancialAdjustmentController {
  constructor(private readonly adjustments: CustomerFinancialAdjustmentService) {}

  @Post()
  @RequireAnyPermission(
    'customer_financial_adjustments:create',
    'customer_financial_adjustments:create_credit',
  )
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCustomerFinancialAdjustmentDto) {
    return this.adjustments.create(user, dto);
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
