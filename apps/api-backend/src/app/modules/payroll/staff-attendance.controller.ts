import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { StaffAttendanceService } from './staff-attendance.service';
import { MarkAttendanceDto } from './dto/mark-attendance.dto';
import { AuthenticatedOnly } from '../../common/decorators/authz-markers.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

/**
 * Staff Attendance — extension to Payroll
 * (docs/features/staff-attendance-and-wage-types.md, Phase 1; RBAC Amendment R16):
 *   - mark            → payroll:attendance_mark  (Manager + Admin by preset)
 *   - listByPeriod    → payroll:attendance_view  (vendor-wide grid)
 *   - listByEmployee  → @AuthenticatedOnly(): every role reads its OWN history
 *     with no permission; another employee's requires payroll:attendance_view —
 *     a code-level check inside the service (see attendance-view-scope.util.ts),
 *     not expressible as a route decorator since "my own record" depends on the
 *     request's own target id. Same precedent as
 *     CrewCashDistributionController.listForEmployee.
 *   - listBySheet     → @AuthenticatedOnly(): access to the sheet itself is
 *     already gated at the page level (daily_sheets:view), mirroring the
 *     sheet's own Crew Cash / Expense lists.
 *
 * Markers are applied per-method, not at the class level — a class-level
 * @AuthenticatedOnly() would silently short-circuit @RequirePermissions() on the
 * same controller (see StaffLedgerController's note).
 */
@Controller()
export class StaffAttendanceController {
  constructor(private readonly attendance: StaffAttendanceService) {}

  /** POST /payroll/attendance/mark — manual per-employee-per-day marking. */
  @Post('payroll/attendance/mark')
  @RequirePermissions('payroll:attendance_mark')
  mark(@CurrentUser() user: AuthUser, @Body() dto: MarkAttendanceDto) {
    return this.attendance.markStatus(user, dto);
  }

  /** GET /payroll/attendance/period/:periodId — one row per employee-day in the period. */
  @Get('payroll/attendance/period/:periodId')
  @RequirePermissions('payroll:attendance_view')
  listByPeriod(@CurrentUser() user: AuthUser, @Param('periodId') periodId: string) {
    return this.attendance.listByPeriod(user, periodId);
  }

  /** GET /payroll/attendance/employee/:userId — one employee's full history. */
  @Get('payroll/attendance/employee/:userId')
  @AuthenticatedOnly()
  listByEmployee(@CurrentUser() user: AuthUser, @Param('userId') userId: string) {
    return this.attendance.listByEmployee(user, userId);
  }

  /** GET /daily-sheets/:dailySheetId/attendance — rows captured for one sheet. */
  @Get('daily-sheets/:dailySheetId/attendance')
  @AuthenticatedOnly()
  listBySheet(@CurrentUser() user: AuthUser, @Param('dailySheetId') dailySheetId: string) {
    return this.attendance.listBySheet(user, dailySheetId);
  }
}
