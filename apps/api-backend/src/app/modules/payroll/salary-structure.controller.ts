import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { SalaryStructureService } from './salary-structure.service';
import { CreateSalaryStructureDto } from './dto/create-salary-structure.dto';
import { EffectiveSalaryStructureQueryDto } from './dto/effective-salary-structure-query.dto';
import { AuthenticatedOnly } from '../../common/decorators/authz-markers.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

/**
 * Recurring baseline salary per employee. Fine-grained payroll:* permissions
 * (rbac-permission-catalog.md §27), replacing the interim
 * `@RequireRoles(VENDOR_ADMIN, STAFF)` gate — see StaffLedgerController's
 * doc comment for why markers are applied per-method rather than at the
 * class level. `create` requires `payroll:salary_structure_manage`
 * (VENDOR_ADMIN, STAFF by preset). The reads stay `@AuthenticatedOnly()`:
 * every role may read its OWN salary structure with no permission at all,
 * and viewing another employee's requires `payroll:view_all` — a code-level
 * check inside `SalaryStructureService` (see
 * `common/helpers/payroll-view-scope.util.ts`).
 */
@Controller('payroll/salary-structures')
export class SalaryStructureController {
  constructor(private readonly salaryStructures: SalaryStructureService) {}

  /** POST /payroll/salary-structures — start a new versioned salary structure. */
  @Post()
  @RequirePermissions('payroll:salary_structure_manage')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateSalaryStructureDto) {
    return this.salaryStructures.create(user, dto);
  }

  /** GET /payroll/salary-structures/employee/:userId — full version history. */
  @Get('employee/:userId')
  @AuthenticatedOnly()
  listHistory(@CurrentUser() user: AuthUser, @Param('userId') userId: string) {
    return this.salaryStructures.listHistory(user, userId);
  }

  /** GET /payroll/salary-structures/employee/:userId/effective?date=... */
  @Get('employee/:userId/effective')
  @AuthenticatedOnly()
  getEffective(
    @CurrentUser() user: AuthUser,
    @Param('userId') userId: string,
    @Query() query: EffectiveSalaryStructureQueryDto,
  ) {
    return this.salaryStructures.getEffectiveOn(user, userId, query.date);
  }
}
