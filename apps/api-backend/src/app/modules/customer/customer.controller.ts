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
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { Response } from 'express';
import { CustomerService } from './customer.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CustomerQueryDto } from './dto/customer-query.dto';
import { SetCustomPriceDto } from './dto/set-custom-price.dto';
import { CreatePortalAccountDto } from './dto/create-portal-account.dto';
import { StatementQueryDto } from './dto/statement-query.dto';
import { ScheduleQueryDto } from './dto/schedule-query.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('customers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Post()
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  create(@CurrentUser() user: any, @Body() dto: CreateCustomerDto) {
    return this.customerService.create(user.vendorId, dto);
  }

  @Get()
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF, UserRole.DRIVER)
  findAll(@CurrentUser() user: any, @Query() query: CustomerQueryDto) {
    return this.customerService.findAllPaginated(user.vendorId, query);
  }

  @Get(':id')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF, UserRole.DRIVER)
  findOne(@CurrentUser() user: any, @Param('id') id: string) {
    return this.customerService.findOne(user.vendorId, id);
  }

  @Patch(':id')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  update(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customerService.update(user.vendorId, id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.VENDOR_ADMIN)
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  remove(@CurrentUser() user: any, @Param('id') id: string) {
    return this.customerService.remove(user.vendorId, id);
  }

  @Post(':id/custom-prices')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  setCustomPrice(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: SetCustomPriceDto,
  ) {
    return this.customerService.setCustomPrice(user.vendorId, id, dto);
  }

  @Delete(':id/custom-prices/:productId')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  removeCustomPrice(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Param('productId') productId: string,
  ) {
    return this.customerService.removeCustomPrice(user.vendorId, id, productId);
  }

  @Get(':id/transactions')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF, UserRole.DRIVER)
  getTransactionHistory(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.customerService.getTransactionHistory(
      user.vendorId,
      id,
      pagination,
    );
  }

  /** POST /customers/:id/portal-account — create login for customer (VENDOR_ADMIN only) */
  @Post(':id/portal-account')
  @Roles(UserRole.VENDOR_ADMIN)
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  createPortalAccount(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: CreatePortalAccountDto,
  ) {
    return this.customerService.createPortalAccount(user.vendorId, id, dto);
  }

  /** DELETE /customers/:id/portal-account — remove customer login access */
  @Delete(':id/portal-account')
  @Roles(UserRole.VENDOR_ADMIN)
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  removePortalAccount(@CurrentUser() user: any, @Param('id') id: string) {
    return this.customerService.removePortalAccount(user.vendorId, id);
  }

  /** GET /customers/:id/statement?month=2026-01 — customer financial statement PDF */
  @Get(':id/statement')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  async getStatement(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Query() query: StatementQueryDto,
    @Res() res: Response,
  ) {
    const buffer = await this.customerService.getMonthlyStatementPdf(
      user.vendorId,
      id,
      query.month,
    );
    const month = query.month ?? new Date().toISOString().slice(0, 7);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="statement-${month}.pdf"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  /** PATCH /customers/:id/deactivate — soft-disable customer, preserves history */
  @Patch(':id/deactivate')
  @Roles(UserRole.VENDOR_ADMIN)
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  deactivate(@CurrentUser() user: any, @Param('id') id: string) {
    return this.customerService.deactivate(user.vendorId, id);
  }

  /** PATCH /customers/:id/reactivate — re-enable a deactivated customer */
  @Patch(':id/reactivate')
  @Roles(UserRole.VENDOR_ADMIN)
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  reactivate(@CurrentUser() user: any, @Param('id') id: string) {
    return this.customerService.reactivate(user.vendorId, id);
  }

  /** GET /customers/:id/consumption?month=2026-02 — consumption rate & bottle stats */
  @Get(':id/consumption')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  getConsumption(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Query() query: StatementQueryDto,
  ) {
    return this.customerService.getConsumptionStats(user.vendorId, id, query.month);
  }

  /** GET /customers/:id/schedule?from=2026-02-01&to=2026-02-28 — delivery calendar */
  @Get(':id/schedule')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF, UserRole.DRIVER)
  getSchedule(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Query() query: ScheduleQueryDto,
  ) {
    return this.customerService.getDeliverySchedule(
      user.vendorId,
      id,
      query.from,
      query.to,
    );
  }
}
