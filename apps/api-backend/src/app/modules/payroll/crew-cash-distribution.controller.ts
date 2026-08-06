import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CrewCashDistributionService } from './crew-cash-distribution.service';
import { CreateCrewCashDistributionDto } from './dto/create-crew-cash-distribution.dto';
import { UpdateCrewCashDistributionDto } from './dto/update-crew-cash-distribution.dto';
import { ApproveCrewCashDistributionDto } from './dto/approve-crew-cash-distribution.dto';
import { RemoveCrewCashDistributionDto } from './dto/remove-crew-cash-distribution.dto';
import { AuthenticatedOnly } from '../../common/decorators/authz-markers.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

/**
 * Crew Cash Distribution — extension to Payroll (rbac-permission-catalog.md
 * §28, Amendment R5):
 *   - create  → crew_cash:create   (SALESMAN, DRIVER, STAFF, VENDOR_ADMIN by preset)
 *   - update/remove → NOT hard-gated by a route decorator — allowed for
 *     crew_cash:edit / crew_cash:delete holders OR the entry's own creator,
 *     and a route decorator can only express one fixed rule, not an "OR the
 *     caller who made this specific row" exception. So both routes stay
 *     `@AuthenticatedOnly()` and the actual decision lives entirely inside
 *     `CrewCashDistributionService` (see its doc comments), same precedent
 *     as `StaffLedgerController.voidEntry`.
 *   - approve → crew_cash:approve  (STAFF, VENDOR_ADMIN by preset)
 *   - listForSheet → `@AuthenticatedOnly()`, tenancy-scoped in the service,
 *     no dedicated permission (mirrors the sheet's own Expense list — access
 *     to the sheet itself is already gated by daily_sheets:view at the page
 *     level).
 *   - listForEmployee → `@AuthenticatedOnly()`: every role may read its OWN
 *     history with no permission at all, and viewing another employee's
 *     requires crew_cash:view_all — a code-level check inside
 *     `CrewCashDistributionService.listForEmployee` (see
 *     `common/helpers/crew-cash-view-scope.util.ts`), not expressible as a
 *     route decorator since "my own record" depends on the request's own
 *     target id.
 *
 * NOTE: markers are applied per-method, not at the class level — see
 * StaffLedgerController's identical note on why a class-level
 * `@AuthenticatedOnly()` would silently short-circuit every
 * `@RequirePermissions()` method on the same controller.
 */
@Controller()
export class CrewCashDistributionController {
  constructor(private readonly crewCash: CrewCashDistributionService) {}

  /** POST /daily-sheets/:dailySheetId/crew-cash — create. */
  @Post('daily-sheets/:dailySheetId/crew-cash')
  @RequirePermissions('crew_cash:create')
  create(
    @CurrentUser() user: AuthUser,
    @Param('dailySheetId') dailySheetId: string,
    @Body() dto: CreateCrewCashDistributionDto,
  ) {
    return this.crewCash.create(user, dailySheetId, dto);
  }

  /** GET /daily-sheets/:dailySheetId/crew-cash — all rows for one sheet. */
  @Get('daily-sheets/:dailySheetId/crew-cash')
  @AuthenticatedOnly()
  listForSheet(@CurrentUser() user: AuthUser, @Param('dailySheetId') dailySheetId: string) {
    return this.crewCash.listForSheet(user, dailySheetId);
  }

  /** GET /crew-cash/employee/:employeeId — one employee's full history. */
  @Get('crew-cash/employee/:employeeId')
  @AuthenticatedOnly()
  listForEmployee(@CurrentUser() user: AuthUser, @Param('employeeId') employeeId: string) {
    return this.crewCash.listForEmployee(user, employeeId);
  }

  /**
   * PATCH /crew-cash/:id — edit (pre-sync only). Open to any authenticated
   * user — `CrewCashDistributionService.update` enforces "crew_cash:edit OR
   * the entry's own creator" as a code-level check.
   */
  @Patch('crew-cash/:id')
  @AuthenticatedOnly()
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateCrewCashDistributionDto) {
    return this.crewCash.update(user, id, dto);
  }

  /**
   * DELETE /crew-cash/:id — hard delete (pre-sync only). Open to any
   * authenticated user — `CrewCashDistributionService.remove` enforces
   * "crew_cash:delete OR the entry's own creator" as a code-level check.
   */
  @Delete('crew-cash/:id')
  @AuthenticatedOnly()
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto?: RemoveCrewCashDistributionDto) {
    return this.crewCash.remove(user, id, dto);
  }

  /** PATCH /crew-cash/:id/approve — PENDING approval -> approved. */
  @Patch('crew-cash/:id/approve')
  @RequirePermissions('crew_cash:approve')
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ApproveCrewCashDistributionDto) {
    return this.crewCash.approve(user, id, dto);
  }
}
