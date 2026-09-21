import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser } from '@water-supply-crm/types';
import { CustomerFinancialAdjustmentService } from './customer-financial-adjustment.service';
import { CreateCustomerFinancialAdjustmentDto } from './dto/create-customer-financial-adjustment.dto';
import { RequireAnyPermission } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * Customer Financial Adjustments (owner-approved 2026-09-21).
 *   - POST /customer-financial-adjustments → post a charge or credit.
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
}
