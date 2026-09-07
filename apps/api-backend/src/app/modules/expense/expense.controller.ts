import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ExpenseService } from './expense.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { ExpenseQueryDto } from './dto/expense-query.dto';
import { CorrectClosedExpenseDto } from './dto/correct-closed-expense.dto';
import { VoidClosedExpenseDto } from './dto/void-closed-expense.dto';
import { AddClosedExpenseDto } from './dto/add-closed-expense.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

@Controller('expenses')
export class ExpenseController {
  constructor(private readonly expenseService: ExpenseService) {}

  @Post()
  @RequirePermissions('expenses:create')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 30 } })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateExpenseDto) {
    return this.expenseService.create(user.vendorId, user.userId, dto);
  }

  // ── Post-Close Expense Correction — static-suffix routes MUST be declared
  // before any `:id`-only param route so NestJS does not shadow `closed` as an
  // `:id` (mirrors the daily-sheet.controller "static routes before /:id"
  // ordering note). `/:id/correct` and `/:id/void` cannot collide with
  // `/:id` (GET/PATCH/DELETE) since they carry an extra segment, but are kept
  // grouped here for readability.
  @Post('closed')
  @RequirePermissions('daily_sheets:edit_closed_expense')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  createClosed(@CurrentUser() user: AuthUser, @Body() dto: AddClosedExpenseDto) {
    return this.expenseService.createClosed(user, dto);
  }

  @Patch(':id/correct')
  @RequirePermissions('daily_sheets:edit_closed_expense')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  correctClosed(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CorrectClosedExpenseDto,
  ) {
    return this.expenseService.correctClosed(user, id, dto);
  }

  @Post(':id/void')
  @RequirePermissions('daily_sheets:edit_closed_expense')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  voidClosed(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: VoidClosedExpenseDto,
  ) {
    return this.expenseService.voidClosed(user, id, dto);
  }

  @Get()
  @RequirePermissions('expenses:view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: ExpenseQueryDto) {
    return this.expenseService.findAll(user.vendorId, query);
  }

  // Must be before /:id to avoid route conflict.
  // Was VENDOR_ADMIN-only → expenses:view (manager gains the summary; see report).
  @Get('summary')
  @RequirePermissions('expenses:view')
  getSummary(@CurrentUser() user: AuthUser, @Query() query: ExpenseQueryDto) {
    return this.expenseService.getSummary(user.vendorId, query.from, query.to);
  }

  @Get(':id')
  @RequirePermissions('expenses:view')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.expenseService.findOne(user.vendorId, id);
  }

  @Patch(':id')
  @RequirePermissions('expenses:update')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 30 } })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateExpenseDto,
  ) {
    return this.expenseService.update(user.vendorId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('expenses:delete')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.expenseService.remove(user.vendorId, id);
  }
}
