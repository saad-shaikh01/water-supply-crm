import { Body, Controller, Delete, Param, Patch, Post } from '@nestjs/common';
import { SheetAdvanceService } from './sheet-advance.service';
import { CreateSheetAdvanceDto } from './dto/create-sheet-advance.dto';
import { UpdateSheetAdvanceDto } from './dto/update-sheet-advance.dto';
import { RemoveSheetAdvanceDto } from './dto/remove-sheet-advance.dto';
import { AuthenticatedOnly } from '../../common/decorators/authz-markers.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

/**
 * Daily Sheet Advances (owner-requested 2026-10-01). Reuses the Payroll ledger's
 * permission family rather than inventing a new resource — recording an advance IS a
 * payroll ledger action, it just happens to be paid from the van's cash:
 *   - create → `payroll:ledger_create` (VENDOR_ADMIN + Manager by preset; a driver /
 *     salesman cannot hand out advances unless an admin grants it).
 *   - edit / delete → NOT hard-gated by a route decorator: allowed for the advance's own
 *     creator OR a `payroll:ledger_void` holder, decided inside `SheetAdvanceService`
 *     ("creator or VENDOR_ADMIN", exactly like `StaffLedgerController.voidEntry` —
 *     a route decorator can't express the "OR the caller who made this row" exception).
 *     On a CLOSED sheet the service additionally requires `daily_sheets:edit_closed_expense`.
 *
 * Markers are applied per-method (a class-level `@AuthenticatedOnly()` would short-circuit
 * the `@RequirePermissions()` method) — see StaffLedgerController's identical note.
 */
@Controller()
export class SheetAdvanceController {
  constructor(private readonly sheetAdvance: SheetAdvanceService) {}

  /** POST /daily-sheets/:dailySheetId/advances — record an advance paid from the van's cash. */
  @Post('daily-sheets/:dailySheetId/advances')
  @RequirePermissions('payroll:ledger_create')
  create(
    @CurrentUser() user: AuthUser,
    @Param('dailySheetId') dailySheetId: string,
    @Body() dto: CreateSheetAdvanceDto,
  ) {
    return this.sheetAdvance.create(user, dailySheetId, dto);
  }

  /** PATCH /sheet-advances/:id — edit in place (service enforces creator-or-ledger_void). */
  @Patch('sheet-advances/:id')
  @AuthenticatedOnly()
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateSheetAdvanceDto) {
    return this.sheetAdvance.update(user, id, dto);
  }

  /** DELETE /sheet-advances/:id — soft void (service enforces creator-or-ledger_void). */
  @Delete('sheet-advances/:id')
  @AuthenticatedOnly()
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: RemoveSheetAdvanceDto) {
    return this.sheetAdvance.remove(user, id, dto ?? {});
  }
}
