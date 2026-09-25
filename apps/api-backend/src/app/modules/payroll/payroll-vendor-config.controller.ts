import { Body, Controller, Get, Put } from '@nestjs/common';
import { PayrollVendorConfigService } from './payroll-vendor-config.service';
import { UpdatePayrollVendorConfigDto } from './dto/update-payroll-vendor-config.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

/**
 * Vendor-wide Payroll settings (attendance cutoff day + the optional
 * cash-deduction window). Gated on the new `payroll:config_manage`
 * permission — VENDOR_ADMIN-only by default, same tier as
 * `period_unlock`/`view_all` (changing the pay-cycle definition is more
 * sensitive than day-to-day ledger entry work, so it is deliberately NOT
 * granted to the Manager preset).
 */
@Controller('payroll/config')
export class PayrollVendorConfigController {
  constructor(private readonly config: PayrollVendorConfigService) {}

  @Get()
  @RequirePermissions('payroll:config_manage')
  getConfig(@CurrentUser() user: AuthUser) {
    return this.config.getConfig(user.vendorId);
  }

  @Put()
  @RequirePermissions('payroll:config_manage')
  updateConfig(@CurrentUser() user: AuthUser, @Body() dto: UpdatePayrollVendorConfigDto) {
    return this.config.updateConfig(user, dto);
  }
}
