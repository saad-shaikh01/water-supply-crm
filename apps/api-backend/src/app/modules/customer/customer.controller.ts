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
import { UpdateLocationDto } from './dto/update-location.dto';
import { CustomerQueryDto } from './dto/customer-query.dto';
import { SetCustomPriceDto } from './dto/set-custom-price.dto';
import { BulkPricePreviewDto, BulkPriceUpdateDto } from './dto/bulk-price-update.dto';
import { CreatePortalAccountDto } from './dto/create-portal-account.dto';
import { StatementQueryDto } from './dto/statement-query.dto';
import { ScheduleQueryDto } from './dto/schedule-query.dto';
import { ConsumptionQueryDto } from './dto/consumption-query.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

@Controller('customers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Post()
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF, UserRole.DRIVER)
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCustomerDto) {
    return this.customerService.create(user.vendorId, dto);
  }

  @Get()
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF, UserRole.DRIVER)
  findAll(@CurrentUser() user: AuthUser, @Query() query: CustomerQueryDto) {
    return this.customerService.findAllPaginated(user.vendorId, query);
  }

  /** POST /customers/pricing/preview — dry-run filter, returns count + customer list */
  @Post('pricing/preview')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  @Throttle({ short: { ttl: 1000, limit: 10 }, medium: { ttl: 60000, limit: 60 } })
  previewBulkPricing(@CurrentUser() user: AuthUser, @Body() dto: BulkPricePreviewDto) {
    return this.customerService.previewBulkPricing(user.vendorId, dto);
  }

  /** POST /customers/pricing/bulk-update — enqueue a background bulk price update job */
  @Post('pricing/bulk-update')
  @Roles(UserRole.VENDOR_ADMIN)
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  enqueueBulkPriceUpdate(@CurrentUser() user: AuthUser, @Body() dto: BulkPriceUpdateDto) {
    return this.customerService.enqueueBulkPriceUpdate(user.vendorId, dto);
  }

  /** GET /customers/pricing/bulk-update/:jobId/status — poll background job progress */
  @Get('pricing/bulk-update/:jobId/status')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  getBulkUpdateJobStatus(@CurrentUser() user: AuthUser, @Param('jobId') jobId: string) {
    return this.customerService.getBulkUpdateJobStatus(user.vendorId, jobId);
  }

  @Get(':id')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF, UserRole.DRIVER)
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.customerService.findOne(user.vendorId, id);
  }

  @Patch(':id')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customerService.update(user.vendorId, id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.VENDOR_ADMIN)
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.customerService.remove(user.vendorId, id);
  }

  @Post(':id/custom-prices')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  setCustomPrice(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: SetCustomPriceDto,
  ) {
    return this.customerService.setCustomPrice(user.vendorId, id, dto);
  }

  @Delete(':id/custom-prices/:productId')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  removeCustomPrice(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('productId') productId: string,
  ) {
    return this.customerService.removeCustomPrice(user.vendorId, id, productId);
  }

  @Get(':id/transactions')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF, UserRole.DRIVER)
  getTransactionHistory(
    @CurrentUser() user: AuthUser,
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
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreatePortalAccountDto,
  ) {
    return this.customerService.createPortalAccount(user.vendorId, id, dto);
  }

  /** DELETE /customers/:id/portal-account — remove customer login access */
  @Delete(':id/portal-account')
  @Roles(UserRole.VENDOR_ADMIN)
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  removePortalAccount(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.customerService.removePortalAccount(user.vendorId, id);
  }

  /** GET /customers/:id/statement?month=2026-01 — customer financial statement PDF */
  @Get(':id/statement')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  async getStatement(
    @CurrentUser() user: AuthUser,
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

  /** PATCH /customers/:id/location — pin GPS coordinates (accessible to drivers) */
  @Patch(':id/location')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF, UserRole.DRIVER)
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 30 } })
  updateLocation(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateLocationDto,
  ) {
    return this.customerService.updateLocation(user.vendorId, id, dto.latitude, dto.longitude);
  }

  /** PATCH /customers/:id/deactivate — soft-disable customer, preserves history */
  @Patch(':id/deactivate')
  @Roles(UserRole.VENDOR_ADMIN)
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  deactivate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.customerService.deactivate(user.vendorId, id);
  }

  /** PATCH /customers/:id/reactivate — re-enable a deactivated customer */
  @Patch(':id/reactivate')
  @Roles(UserRole.VENDOR_ADMIN)
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  reactivate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.customerService.reactivate(user.vendorId, id);
  }

  /** GET /customers/:id/consumption — bottle consumption stats; supports ?month=YYYY-MM, ?from=YYYY-MM-DD&to=YYYY-MM-DD, ?allTime=true, or defaults to last 30 days */
  @Get(':id/consumption')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  getConsumption(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() query: ConsumptionQueryDto,
  ) {
    return this.customerService.getConsumptionStats(user.vendorId, id, query);
  }

  /** GET /customers/:id/schedule?from=2026-02-01&to=2026-02-28 — delivery calendar */
  @Get(':id/schedule')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF, UserRole.DRIVER)
  getSchedule(
    @CurrentUser() user: AuthUser,
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

  /** GET /customers/:id/financial-summary — current/last month paid, due, bottles, last delivery */
  @Get(':id/financial-summary')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  getFinancialSummary(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.customerService.getFinancialSummary(user.vendorId, id);
  }
}
