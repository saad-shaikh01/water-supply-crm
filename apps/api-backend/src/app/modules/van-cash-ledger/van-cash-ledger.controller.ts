import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { VanCashLedgerService } from './van-cash-ledger.service';
import { SetOpeningBalanceDto } from './dto/set-opening-balance.dto';
import { ApproveHandoverDto } from './dto/approve-handover.dto';
import {
  VanCashLedgerPendingQueryDto,
  VanCashLedgerStatsQueryDto,
  VanCashLedgerTimelineQueryDto,
} from './dto/van-cash-ledger-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

/**
 * Van Cash Ledger — the "cash in" counterpart to the Expense Center.
 *   - opening-balance → van_cash_ledger:manage (VENDOR_ADMIN only by preset).
 *   - timeline/stats/pending-handovers → van_cash_ledger:view (Manager/
 *     Accountant tier and up).
 *   - cash-in/:id/approve → van_cash_ledger:approve (Manager/Accountant/Admin).
 */
@Controller('van-cash-ledger')
export class VanCashLedgerController {
  constructor(private readonly vanCashLedger: VanCashLedgerService) {}

  @Post('opening-balance')
  @RequirePermissions('van_cash_ledger:manage')
  setOpeningBalance(@CurrentUser() user: AuthUser, @Body() dto: SetOpeningBalanceDto) {
    return this.vanCashLedger.setOpeningBalance(user, dto);
  }

  @Get('timeline')
  @RequirePermissions('van_cash_ledger:view')
  getTimeline(@CurrentUser() user: AuthUser, @Query() query: VanCashLedgerTimelineQueryDto) {
    return this.vanCashLedger.getTimeline(user.vendorId, query);
  }

  @Get('stats')
  @RequirePermissions('van_cash_ledger:view')
  getStats(@CurrentUser() user: AuthUser, @Query() query: VanCashLedgerStatsQueryDto) {
    return this.vanCashLedger.getStats(user.vendorId, query);
  }

  @Get('pending-handovers')
  @RequirePermissions('van_cash_ledger:view')
  getPendingHandovers(@CurrentUser() user: AuthUser, @Query() query: VanCashLedgerPendingQueryDto) {
    return this.vanCashLedger.getPendingHandovers(user.vendorId, query.vanId);
  }

  @Patch('cash-in/:id/approve')
  @RequirePermissions('van_cash_ledger:approve')
  approveHandover(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ApproveHandoverDto) {
    return this.vanCashLedger.approveHandover(user, id, dto);
  }
}
