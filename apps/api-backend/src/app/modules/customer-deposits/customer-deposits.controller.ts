import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser } from '@water-supply-crm/types';
import { CustomerDepositsService } from './customer-deposits.service';
import { CollectDepositDto } from './dto/collect-deposit.dto';
import { RefundDepositDto } from './dto/refund-deposit.dto';
import { WriteOffDepositDto } from './dto/write-off-deposit.dto';
import { VoidDepositEntryDto } from './dto/void-deposit-entry.dto';
import { UpdateDepositConfigDto } from './dto/update-deposit-config.dto';
import { ApplyDepositToBalanceDto } from './dto/apply-deposit-to-balance.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * Customer Deposits (owner-requested 2026-09-29).
 *   - GET   /customer-deposits/config             → whether deposits are enabled for this vendor (`view`).
 *   - PATCH /customer-deposits/config              → turn the feature on/off (`manage_config`, Vendor-Admin-only by default).
 *   - GET   /customers/:customerId/deposits        → a customer's deposit balances + entry history (`view`).
 *   - POST  /customers/:customerId/deposits/collect → record a deposit collected (`collect`).
 *   - POST  /customer-deposits/:depositId/refund    → refund part/all of a held CASH/BOTTLE deposit (`refund`).
 *   - POST  /customer-deposits/:depositId/apply-to-balance → CASH only: return part/all as a credit
 *     against what the customer owes, instead of physical cash (`refund`, Closure Settlement).
 *   - POST  /customer-deposits/:depositId/write-off → close out a deposit without a cash/bottle movement (`write_off`).
 *   - POST  /customer-deposit-entries/:entryId/void → reverse a POSTED entry (`void`).
 * Static routes (`config`) are declared before any dynamic `:id` route — the
 * NestJS route-shadowing convention used throughout this codebase.
 */
@Controller()
export class CustomerDepositsController {
  constructor(private readonly deposits: CustomerDepositsService) {}

  @Get('customer-deposits/config')
  @RequirePermissions('customer_deposits:view')
  getConfig(@CurrentUser() user: AuthUser) {
    return this.deposits.getConfig(user.vendorId);
  }

  @Patch('customer-deposits/config')
  @RequirePermissions('customer_deposits:manage_config')
  updateConfig(@CurrentUser() user: AuthUser, @Body() dto: UpdateDepositConfigDto) {
    return this.deposits.updateConfig(user, dto.depositsEnabled);
  }

  @Get('customers/:customerId/deposits')
  @RequirePermissions('customer_deposits:view')
  listForCustomer(@CurrentUser() user: AuthUser, @Param('customerId') customerId: string) {
    return this.deposits.listForCustomer(user.vendorId, customerId);
  }

  @Post('customers/:customerId/deposits/collect')
  @RequirePermissions('customer_deposits:collect')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  collect(
    @CurrentUser() user: AuthUser,
    @Param('customerId') customerId: string,
    @Body() dto: CollectDepositDto,
  ) {
    return this.deposits.collect(user, customerId, dto);
  }

  @Post('customer-deposits/:depositId/refund')
  @RequirePermissions('customer_deposits:refund')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  refund(
    @CurrentUser() user: AuthUser,
    @Param('depositId') depositId: string,
    @Body() dto: RefundDepositDto,
  ) {
    return this.deposits.refund(user, depositId, dto);
  }

  @Post('customer-deposits/:depositId/apply-to-balance')
  @RequirePermissions('customer_deposits:refund')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  applyToBalance(
    @CurrentUser() user: AuthUser,
    @Param('depositId') depositId: string,
    @Body() dto: ApplyDepositToBalanceDto,
  ) {
    return this.deposits.applyToBalance(user, depositId, dto);
  }

  @Post('customer-deposits/:depositId/write-off')
  @RequirePermissions('customer_deposits:write_off')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  writeOff(
    @CurrentUser() user: AuthUser,
    @Param('depositId') depositId: string,
    @Body() dto: WriteOffDepositDto,
  ) {
    return this.deposits.writeOff(user, depositId, dto);
  }

  @Post('customer-deposit-entries/:entryId/void')
  @RequirePermissions('customer_deposits:void')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  voidEntry(
    @CurrentUser() user: AuthUser,
    @Param('entryId') entryId: string,
    @Body() dto: VoidDepositEntryDto,
  ) {
    return this.deposits.voidEntry(user, entryId, dto);
  }
}
