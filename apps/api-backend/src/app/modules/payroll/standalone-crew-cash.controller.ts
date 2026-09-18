import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { StandaloneCrewCashService } from './standalone-crew-cash.service';
import { CreateStandaloneCrewCashDto } from './dto/create-standalone-crew-cash.dto';
import { UpdateStandaloneCrewCashDto } from './dto/update-standalone-crew-cash.dto';
import { VoidStandaloneCrewCashDto } from './dto/void-standalone-crew-cash.dto';
import { StandaloneCrewCashQueryDto } from './dto/standalone-crew-cash-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

/**
 * Standalone Crew Cash — crew cash given WITHOUT a Daily Sheet
 * (owner-requested 2026-09-18). Reuses the existing `crew_cash:*` permission
 * family (rbac-permission-catalog.md §28) rather than a new resource — this
 * is the same underlying action (recording cash given to an employee) as
 * `CrewCashDistributionController`, just without a sheet in the URL.
 *   - create → crew_cash:create (same cohort as sheet-scoped Crew Cash)
 *   - list   → crew_cash:view_all (this is a vendor-wide, not per-sheet, list)
 *   - edit   → crew_cash:edit (in place while the payroll twin is unlocked)
 *   - void   → crew_cash:delete (closest existing analog to "undo an entry
 *     you weren't supposed to be able to edit anymore")
 */
@Controller('crew-cash/standalone')
export class StandaloneCrewCashController {
  constructor(private readonly standaloneCrewCash: StandaloneCrewCashService) {}

  @Post()
  @RequirePermissions('crew_cash:create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateStandaloneCrewCashDto) {
    return this.standaloneCrewCash.create(user, dto);
  }

  @Get()
  @RequirePermissions('crew_cash:view_all')
  list(@CurrentUser() user: AuthUser, @Query() query: StandaloneCrewCashQueryDto) {
    return this.standaloneCrewCash.list(user, query);
  }

  // `:id` and `:id/void` have different segment counts, so they never shadow each other.
  @Patch(':id')
  @RequirePermissions('crew_cash:edit')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateStandaloneCrewCashDto) {
    return this.standaloneCrewCash.update(user, id, dto);
  }

  @Patch(':id/void')
  @RequirePermissions('crew_cash:delete')
  void(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: VoidStandaloneCrewCashDto) {
    return this.standaloneCrewCash.void(user, id, dto);
  }
}
