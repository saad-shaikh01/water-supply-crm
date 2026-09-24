import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { StaffAdvancePlanService } from './staff-advance-plan.service';
import { CreateAdvancePlanDto } from './dto/create-advance-plan.dto';
import { UpdateAdvancePlanDto } from './dto/update-advance-plan.dto';
import { CollectAdvanceInstallmentDto } from './dto/collect-advance-installment.dto';
import { WriteOffAdvancePlanDto } from './dto/write-off-advance-plan.dto';
import { AuthenticatedOnly } from '../../common/decorators/authz-markers.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

/**
 * Advance Installments (owner-requested 2026-09-24, Amendment R21) — create/
 * update/write-off a `StaffAdvancePlan` and Collect/Skip its
 * `StaffAdvanceInstallment` rows all require `payroll:advance_plan_manage`.
 * `listForEmployee` stays self-vs-`payroll:view_all` scoped, same as every
 * other payroll read endpoint (`SettlementController.listForEntry`
 * precedent). `getVendorSummary`/`countPendingForPeriod` (2026-09-25) are
 * vendor-wide aggregate reads for the Payroll Dashboard card and the Lock
 * Period warning respectively.
 */
@Controller('payroll')
export class StaffAdvancePlanController {
  constructor(private readonly advancePlans: StaffAdvancePlanService) {}

  /** POST /payroll/advance-plans */
  @Post('advance-plans')
  @RequirePermissions('payroll:advance_plan_manage')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAdvancePlanDto) {
    return this.advancePlans.create(user, dto);
  }

  /** PATCH /payroll/advance-plans/:id */
  @Patch('advance-plans/:id')
  @RequirePermissions('payroll:advance_plan_manage')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateAdvancePlanDto) {
    return this.advancePlans.update(user, id, dto);
  }

  /** GET /payroll/advance-plans/vendor-summary — Payroll Dashboard's Outstanding Advances card. Static, registered before employee/:userId. */
  @Get('advance-plans/vendor-summary')
  @RequirePermissions('payroll:view_all')
  getVendorSummary(@CurrentUser() user: AuthUser) {
    return this.advancePlans.getVendorSummary(user);
  }

  /** GET /payroll/advance-plans/employee/:userId — every plan for one employee. */
  @Get('advance-plans/employee/:userId')
  @AuthenticatedOnly()
  listForEmployee(@CurrentUser() user: AuthUser, @Param('userId') userId: string) {
    return this.advancePlans.listForEmployee(user, userId);
  }

  /** POST /payroll/advance-plans/:id/write-off */
  @Post('advance-plans/:id/write-off')
  @RequirePermissions('payroll:advance_plan_manage')
  writeOff(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: WriteOffAdvancePlanDto) {
    return this.advancePlans.writeOff(user, id, dto);
  }

  /** GET /payroll/advance-installments/period/:periodId/pending-count — Lock Period warning, same gate as the lock action itself. */
  @Get('advance-installments/period/:periodId/pending-count')
  @RequirePermissions('payroll:period_lock')
  countPendingForPeriod(@CurrentUser() user: AuthUser, @Param('periodId') periodId: string) {
    return this.advancePlans.countPendingForPeriod(user, periodId);
  }

  /** POST /payroll/advance-installments/:id/collect */
  @Post('advance-installments/:id/collect')
  @RequirePermissions('payroll:advance_plan_manage')
  collect(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CollectAdvanceInstallmentDto) {
    return this.advancePlans.collect(user, id, dto);
  }

  /** POST /payroll/advance-installments/:id/skip */
  @Post('advance-installments/:id/skip')
  @RequirePermissions('payroll:advance_plan_manage')
  skip(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.advancePlans.skip(user, id);
  }
}
