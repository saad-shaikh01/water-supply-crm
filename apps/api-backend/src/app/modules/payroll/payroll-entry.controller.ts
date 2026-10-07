import { Body, Controller, Get, Param, Patch, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PayrollExportService } from './payroll-export.service';
import { csvResponseHeaders } from '../van-cash-ledger/cash-ledger-export.csv';
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
  constructor(
    private readonly payrollEntries: PayrollEntryService,
    private readonly payrollExport: PayrollExportService,
  ) {}

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

  /**
   * GET /payroll/periods/:periodId/export.csv — the whole period (one row per employee) as a CSV.
   * Same gate as the table it exports (`payroll:view_all`); works for LOCKED / PAID periods too.
   */
  @Get('periods/:periodId/export.csv')
  @RequirePermissions('payroll:view_all')
  async exportPeriodCsv(@CurrentUser() user: AuthUser, @Param('periodId') periodId: string, @Res() res: Response) {
    const result = await this.payrollExport.exportPeriodCsv(user, periodId);
    res.set(csvResponseHeaders(result));
    res.end(result.body);
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
    return this.payrollEntries.approveEntry(user, id, dto.version, dto.acknowledgePendingAbsences === true);
  }

  /**
   * PATCH /payroll/entries/:id/recalculate — refreshes an APPROVED/UNDER_REVIEW
   * entry's buckets and finalPayable from the live ledger, without locking the
   * period. Same permission as approve — recalculating a reviewed entry's
   * numbers is the same tier of action as approving it.
   */
  @Patch('entries/:id/recalculate')
  @RequirePermissions('payroll:entry_approve')
  recalculateEntry(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ApprovePayrollEntryDto) {
    return this.payrollEntries.recalculateEntry(user, id, dto.version);
  }
}
