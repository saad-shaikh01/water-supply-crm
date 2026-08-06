import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import { PayrollPeriodService } from './payroll-period.service';
import { UnlockPayrollPeriodDto } from './dto/unlock-payroll-period.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

/**
 * PayrollPeriod lifecycle (OPEN -> REVIEW -> LOCKED -> PAID). Fine-grained
 * payroll:* permissions (rbac-permission-catalog.md §27), replacing the
 * interim `@RequireRoles` gate — see StaffLedgerController's doc comment
 * for why markers are applied per-method rather than at the class level.
 * `getOrCreateOpenPeriod`/`lockPeriod` require `payroll:period_generate` /
 * `payroll:period_lock` (VENDOR_ADMIN, STAFF by preset for generate;
 * VENDOR_ADMIN only for lock); unlock requires `payroll:period_unlock`,
 * intentionally VENDOR_ADMIN-only by preset per the planning doc (§10:
 * "Unlock a locked period: VENDOR_ADMIN only, and only with a mandatory
 * reason").
 */
@Controller('payroll/periods')
export class PayrollPeriodController {
  constructor(private readonly payrollPeriods: PayrollPeriodService) {}

  /** POST /payroll/periods/open — find-or-create the vendor's current OPEN period. */
  @Post('open')
  @RequirePermissions('payroll:period_generate')
  getOrCreateOpenPeriod(@CurrentUser() user: AuthUser) {
    return this.payrollPeriods.getOrCreateOpenPeriod(user);
  }

  /** PATCH /payroll/periods/:id/lock — requires every entry APPROVED first. */
  @Patch(':id/lock')
  @RequirePermissions('payroll:period_lock')
  lockPeriod(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.payrollPeriods.lockPeriod(user, id);
  }

  /** PATCH /payroll/periods/:id/unlock — VENDOR_ADMIN only, mandatory reason. */
  @Patch(':id/unlock')
  @RequirePermissions('payroll:period_unlock')
  unlockPeriod(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UnlockPayrollPeriodDto) {
    return this.payrollPeriods.unlockPeriod(user, id, dto.reason);
  }
}
