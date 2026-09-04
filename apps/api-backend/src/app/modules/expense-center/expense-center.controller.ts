import { Controller, Get, Query } from '@nestjs/common';
import { ExpenseCenterService } from './expense-center.service';
import {
  ExpenseCenterSummaryQueryDto,
  ExpenseCenterTimelineQueryDto,
} from './dto/expense-center-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

/**
 * Expense Center — Phase 1 is strictly read-only: it reports on money already
 * recorded through the existing surfaces (Expenses, Fleet, Trip Expenses,
 * Payroll Ledger, Crew Cash) and creates nothing of its own.
 *
 * Authorization reuses the existing `expenses:view` key rather than minting a
 * new permission — anyone who may already see the expense list may see the same
 * money aggregated, and Phase 1 exposes no field they could not reach today.
 */
@Controller('expense-center')
export class ExpenseCenterController {
  constructor(private readonly expenseCenterService: ExpenseCenterService) {}

  @Get('summary')
  @RequirePermissions('expenses:view')
  getSummary(@CurrentUser() user: AuthUser, @Query() query: ExpenseCenterSummaryQueryDto) {
    return this.expenseCenterService.getSummary(user.vendorId, query);
  }

  @Get('timeline')
  @RequirePermissions('expenses:view')
  getTimeline(@CurrentUser() user: AuthUser, @Query() query: ExpenseCenterTimelineQueryDto) {
    return this.expenseCenterService.getTimeline(user.vendorId, query);
  }
}
