import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SheetDiscrepancyCaseService } from './sheet-discrepancy-case.service';
import { ResolveDiscrepancyCaseDto } from './dto/resolve-discrepancy-case.dto';
import { DiscrepancyCaseQueryDto } from './dto/discrepancy-case-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

/**
 * Sheet Discrepancy Case review queue. Cases are exclusively system-generated
 * inside DailySheetService.closeSheet() — there is no create/report route
 * here (unlike DamageCase, which is driver-initiated).
 */
@Controller('sheet-discrepancy-cases')
export class SheetDiscrepancyCaseController {
  constructor(private readonly discrepancyCases: SheetDiscrepancyCaseService) {}

  /** GET /sheet-discrepancy-cases — full vendor queue (STAFF/VENDOR_ADMIN). */
  @Get()
  @RequirePermissions('sheet_discrepancies:view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: DiscrepancyCaseQueryDto) {
    return this.discrepancyCases.findAll(user, query);
  }

  /** GET /sheet-discrepancy-cases/:id */
  @Get(':id')
  @RequirePermissions('sheet_discrepancies:view')
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.discrepancyCases.findOne(user, id);
  }

  /** GET /sheet-discrepancy-cases/:id/audit-log */
  @Get(':id/audit-log')
  @RequirePermissions('sheet_discrepancies:view')
  getAuditLog(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.discrepancyCases.getAuditLog(user, id);
  }

  /**
   * PATCH /sheet-discrepancy-cases/:id/resolve
   * REPORTED → RESOLVED, as CHARGED_TO_DRIVER / COMPANY_LOSS / WAIVED.
   */
  @Patch(':id/resolve')
  @RequirePermissions('sheet_discrepancies:resolve')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 15 } })
  resolve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveDiscrepancyCaseDto,
  ) {
    return this.discrepancyCases.resolve(user, id, dto);
  }
}
