import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { SettlementService } from './settlement.service';
import { RecordSettlementDto } from './dto/record-settlement.dto';
import { MarkSettledDto } from './dto/mark-settled.dto';
import { AuthenticatedOnly } from '../../common/decorators/authz-markers.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

/**
 * Settlement — recording actual disbursement against a locked PayrollEntry
 * (§4/§7/§9/§10 of the planning doc, rbac-permission-catalog.md §27
 * Amendment R4). `record`/`markSettled` require `payroll:settlement_record`
 * (VENDOR_ADMIN, STAFF by preset); `listForEntry` stays `@AuthenticatedOnly()`
 * with the same self-vs-`payroll:view_all` code-level scoping used by
 * `PayrollEntryController.getBreakdown` (see
 * `common/helpers/payroll-view-scope.util.ts`), since the target employee is
 * only known after the entry (identified by its own id) is fetched.
 */
@Controller('payroll')
export class SettlementController {
  constructor(private readonly settlements: SettlementService) {}

  /** POST /payroll/entries/:id/settlements — record one payment (full or partial). */
  @Post('entries/:id/settlements')
  @RequirePermissions('payroll:settlement_record')
  record(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: RecordSettlementDto) {
    return this.settlements.record(user, id, dto);
  }

  /** PATCH /payroll/entries/:id/mark-settled — explicit close-out without requiring a matching sum. */
  @Patch('entries/:id/mark-settled')
  @RequirePermissions('payroll:settlement_record')
  markSettled(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: MarkSettledDto) {
    return this.settlements.markSettled(user, id, dto.version);
  }

  /** GET /payroll/entries/:id/settlements — all settlements for one entry, plus live remaining balance. */
  @Get('entries/:id/settlements')
  @AuthenticatedOnly()
  listForEntry(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.settlements.listForEntry(user, id);
  }
}
