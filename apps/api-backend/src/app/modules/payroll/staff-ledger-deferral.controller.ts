import { Body, Controller, Param, Post } from '@nestjs/common';
import { StaffLedgerDeferralService } from './staff-ledger-deferral.service';
import { DeferLedgerEntryDto, UndoDeferLedgerEntryDto } from './dto/defer-ledger-entry.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

/**
 * "Deduct next month" for one staff ledger deduction. Gated on `payroll:ledger_void`: moving a
 * deduction to a later period is the milder sibling of voiding (waiving) it, so it needs the same
 * authority — and no new permission has to be added to the frozen catalogue/presets.
 */
@Controller('payroll/ledger-entries')
export class StaffLedgerDeferralController {
  constructor(private readonly deferral: StaffLedgerDeferralService) {}

  /** POST /payroll/ledger-entries/:id/defer — charge this deduction in the next payroll period. */
  @Post(':id/defer')
  @RequirePermissions('payroll:ledger_void')
  defer(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: DeferLedgerEntryDto) {
    return this.deferral.defer(user, id, dto);
  }

  /** POST /payroll/ledger-entries/:id/undo-defer — put a deferred entry back in its original period. */
  @Post(':id/undo-defer')
  @RequirePermissions('payroll:ledger_void')
  undoDefer(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UndoDeferLedgerEntryDto) {
    return this.deferral.undoDefer(user, id, dto);
  }
}
