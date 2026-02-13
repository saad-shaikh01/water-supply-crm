import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { ExpenseService } from './expense.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { ExpenseQueryDto } from './dto/expense-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('expenses')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExpenseController {
  constructor(private readonly expenseService: ExpenseService) {}

  @Post()
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 30 } })
  create(@CurrentUser() user: any, @Body() dto: CreateExpenseDto) {
    return this.expenseService.create(user.vendorId, user.userId, dto);
  }

  @Get()
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  findAll(@CurrentUser() user: any, @Query() query: ExpenseQueryDto) {
    return this.expenseService.findAll(user.vendorId, query);
  }

  // Must be before /:id to avoid route conflict
  @Get('summary')
  @Roles(UserRole.VENDOR_ADMIN)
  getSummary(@CurrentUser() user: any, @Query() query: ExpenseQueryDto) {
    return this.expenseService.getSummary(user.vendorId, query.from, query.to);
  }

  @Get(':id')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  findOne(@CurrentUser() user: any, @Param('id') id: string) {
    return this.expenseService.findOne(user.vendorId, id);
  }

  @Patch(':id')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 30 } })
  update(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateExpenseDto,
  ) {
    return this.expenseService.update(user.vendorId, id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.VENDOR_ADMIN)
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  remove(@CurrentUser() user: any, @Param('id') id: string) {
    return this.expenseService.remove(user.vendorId, id);
  }
}
