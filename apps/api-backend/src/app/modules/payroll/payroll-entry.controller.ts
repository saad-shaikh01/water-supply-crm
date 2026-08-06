import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { PayrollEntryService } from './payroll-entry.service';
import { ApprovePayrollEntryDto } from './dto/approve-payroll-entry.dto';
import { AuthenticatedOnly } from '../../common/decorators/authz-markers.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

/**
 * The payroll calculation engine's HTTP surface. Fine-grained payroll:*
 * permissions (rbac-permission-catalog.md §27), replacing the interim
 * `@RequireRoles(VENDOR_ADMIN, STAFF)` gate — see StaffLedgerController's
 * doc comment for why markers are applied per-method rather than at the
 * class level.
 *   - generateDraft → payroll:period_generate (VENDOR_ADMIN, STAFF by preset)
 *   - approveEntry  → payroll:entry_approve   (VENDOR_ADMIN only by preset)
 *   - listForPeriod → payroll:view_all — unlike getBreakdown/findForEmployee,
 *     this route has no single target employee to self-scope against (it
 *     returns "one row per employee" for the whole period, i.e. it *is* the
 *     "View payroll (all employees)" capability from §10), so it is gated by
 *     a straight permission check rather than a code-level self-view split.
 *   - getBreakdown  → stays `@AuthenticatedOnly()`: every role may read its
 *     OWN entry's breakdown with no permission at all, and viewing another
 *     employee's entry requires `payroll:view_all` — a code-level check
 *     inside `PayrollEntryService.getBreakdown` (see
 *     `common/helpers/payroll-view-scope.util.ts`), since the target
 *     employee is only known after the entry (identified by its own id, not
 *     a userId) is fetched.
 */
@Controller('payroll')
export class PayrollEntryController {
  constructor(private readonly payrollEntries: PayrollEntryService) {}

  /** POST /payroll/periods/:periodId/entries/generate — compute/upsert one entry per eligible employee. */
  @Post('periods/:periodId/entries/generate')
  @RequirePermissions('payroll:period_generate')
  generateDraft(@CurrentUser() user: AuthUser, @Param('periodId') periodId: string) {
    return this.payrollEntries.generateDraft(user, periodId);
  }

  /** GET /payroll/periods/:periodId/entries — one row per employee, table view. */
  @Get('periods/:periodId/entries')
  @RequirePermissions('payroll:view_all')
  listForPeriod(@CurrentUser() user: AuthUser, @Param('periodId') periodId: string) {
    return this.payrollEntries.listForPeriod(user, periodId);
  }

  /** GET /payroll/entries/:id/breakdown — full itemized breakdown for one entry. */
  @Get('entries/:id/breakdown')
  @AuthenticatedOnly()
  getBreakdown(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.payrollEntries.getBreakdown(user, id);
  }

  /** PATCH /payroll/entries/:id/approve — DRAFT -> APPROVED. */
  @Patch('entries/:id/approve')
  @RequirePermissions('payroll:entry_approve')
  approveEntry(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ApprovePayrollEntryDto) {
    return this.payrollEntries.approveEntry(user, id, dto.version);
  }
}
