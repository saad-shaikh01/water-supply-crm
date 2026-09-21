import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser } from '@water-supply-crm/types';
import { CustomerFinancialAdjustmentTransferService } from './customer-financial-adjustment-transfer.service';
import { CreateBalanceTransferDto } from './dto/create-balance-transfer.dto';
import { TransferPreviewQueryDto } from './dto/transfer-preview-query.dto';
import { VoidCustomerFinancialAdjustmentDto } from './dto/void-customer-financial-adjustment.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * Balance transfers between two customers (owner-approved 2026-09-21).
 *   - GET  /customer-financial-adjustments/transfers/preview       → dialog data (`transfer`)
 *   - POST /customer-financial-adjustments/transfers               → post a transfer (`transfer`)
 *   - POST /customer-financial-adjustments/transfers/:groupId/void → void BOTH legs
 *     (`void` AND `transfer`; a reason is mandatory)
 *
 * Its own controller under the adjustments prefix so the single-customer controller is
 * untouched, and registered BEFORE it in the module: the `transfers/...` routes are then
 * always matched ahead of that controller's dynamic `:id` routes (the NestJS
 * route-shadowing convention used throughout this codebase). Every route's permission is
 * static, so the route guard is the whole check for the read; the two writes re-assert
 * theirs in the service as defence in depth.
 */
@Controller('customer-financial-adjustments/transfers')
export class CustomerFinancialAdjustmentTransferController {
  constructor(private readonly transfers: CustomerFinancialAdjustmentTransferService) {}

  @Get('preview')
  @RequirePermissions('customer_financial_adjustments:transfer')
  preview(@CurrentUser() user: AuthUser, @Query() query: TransferPreviewQueryDto) {
    return this.transfers.preview(user.vendorId, query);
  }

  @Post()
  @RequirePermissions('customer_financial_adjustments:transfer')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateBalanceTransferDto) {
    return this.transfers.create(user, dto);
  }

  @Post(':groupId/void')
  @RequirePermissions(
    'customer_financial_adjustments:void',
    'customer_financial_adjustments:transfer',
  )
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  voidTransfer(
    @CurrentUser() user: AuthUser,
    @Param('groupId') groupId: string,
    @Body() dto: VoidCustomerFinancialAdjustmentDto,
  ) {
    return this.transfers.voidTransfer(user, groupId, dto);
  }
}
