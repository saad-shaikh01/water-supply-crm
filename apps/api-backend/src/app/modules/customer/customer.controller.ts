import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { CustomerService } from './customer.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { CustomerQueryDto } from './dto/customer-query.dto';
import { SetCustomPriceDto } from './dto/set-custom-price.dto';
import { BulkPricePreviewDto, BulkPriceUpdateDto } from './dto/bulk-price-update.dto';
import { BulkScheduleUpdateDto } from './dto/bulk-schedule-update.dto';
import { StatementQueryDto } from './dto/statement-query.dto';
import { ScheduleQueryDto } from './dto/schedule-query.dto';
import { ConsumptionQueryDto } from './dto/consumption-query.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

@Controller('customers')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  @Post()
  @RequirePermissions('customers:create')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCustomerDto) {
    return this.customerService.create(user.vendorId, dto);
  }

  @Get()
  @RequirePermissions('customers:view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: CustomerQueryDto) {
    return this.customerService.findAllPaginated(user.vendorId, query);
  }

  // ── Pricing (governed by the pricing permission set, not customer perms) ────
  /** POST /customers/pricing/preview — dry-run filter, returns count + customer list */
  @Post('pricing/preview')
  @RequirePermissions('pricing:view')
  @Throttle({ short: { ttl: 1000, limit: 10 }, medium: { ttl: 60000, limit: 60 } })
  previewBulkPricing(@CurrentUser() user: AuthUser, @Body() dto: BulkPricePreviewDto) {
    return this.customerService.previewBulkPricing(user.vendorId, dto);
  }

  /** POST /customers/pricing/bulk-update — enqueue a background bulk price update job */
  @Post('pricing/bulk-update')
  @RequirePermissions('pricing:update')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  enqueueBulkPriceUpdate(@CurrentUser() user: AuthUser, @Body() dto: BulkPriceUpdateDto) {
    return this.customerService.enqueueBulkPriceUpdate(user.vendorId, dto);
  }

  /** GET /customers/pricing/bulk-update/:jobId/status — poll background job progress */
  @Get('pricing/bulk-update/:jobId/status')
  @RequirePermissions('pricing:view')
  getBulkUpdateJobStatus(@CurrentUser() user: AuthUser, @Param('jobId') jobId: string) {
    return this.customerService.getBulkUpdateJobStatus(user.vendorId, jobId);
  }

  // ── Bulk schedule update (governed by customers:update, same as the per-customer PATCH) ──
  /** POST /customers/schedule/bulk-update — reassign van and/or delivery day for selected customers */
  @Post('schedule/bulk-update')
  @RequirePermissions('customers:update')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  bulkUpdateSchedule(@CurrentUser() user: AuthUser, @Body() dto: BulkScheduleUpdateDto) {
    return this.customerService.bulkUpdateSchedule(user.vendorId, dto);
  }

  @Get(':id')
  @RequirePermissions('customers:view')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.customerService.findOne(user.vendorId, id);
  }

  @Patch(':id')
  @RequirePermissions('customers:update')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customerService.update(user.vendorId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('customers:delete')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.customerService.remove(user.vendorId, id);
  }

  // Per-customer custom pricing → pricing:update (a pricing capability).
  @Post(':id/custom-prices')
  @RequirePermissions('pricing:update')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  setCustomPrice(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: SetCustomPriceDto,
  ) {
    return this.customerService.setCustomPrice(user.vendorId, id, dto);
  }

  @Delete(':id/custom-prices/:productId')
  @RequirePermissions('pricing:update')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  removeCustomPrice(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('productId') productId: string,
  ) {
    return this.customerService.removeCustomPrice(user.vendorId, id, productId);
  }

  // ── Financial views (on-screen) → customers:view ──────────────────────────
  @Get(':id/transactions')
  @RequirePermissions('customers:view')
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

  // ── Portal account management → customers:manage_portal (admin-only) ────────
  // Note: portal accounts are now created by the customer via self-service
  // activation (POST /customer-activation/activate) using their Customer Code +
  // registered phone number. Admins can only revoke access, not create it.
  /** DELETE /customers/:id/portal-account — remove customer login access */
  @Delete(':id/portal-account')
  @RequirePermissions('customers:manage_portal')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  removePortalAccount(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.customerService.removePortalAccount(user.vendorId, id);
  }

  // Statement PDF is a downloadable financial export → customers:export.
  /** GET /customers/:id/statement?month=2026-01 — customer financial statement PDF */
  @Get(':id/statement')
  @RequirePermissions('customers:export')
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

  /** PATCH /customers/:id/location — pin GPS coordinates (field/driver capability) */
  @Patch(':id/location')
  @RequirePermissions('customers:update_location')
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
  @RequirePermissions('customers:deactivate')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  deactivate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.customerService.deactivate(user.vendorId, id);
  }

  /** PATCH /customers/:id/reactivate — re-enable a deactivated customer */
  @Patch(':id/reactivate')
  @RequirePermissions('customers:restore')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  reactivate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.customerService.reactivate(user.vendorId, id);
  }

  /** GET /customers/:id/consumption — bottle consumption stats (financial/analytics). */
  @Get(':id/consumption')
  @RequirePermissions('customers:view_financial')
  getConsumption(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() query: ConsumptionQueryDto,
  ) {
    return this.customerService.getConsumptionStats(user.vendorId, id, query);
  }

  /** GET /customers/:id/schedule — delivery calendar */
  @Get(':id/schedule')
  @RequirePermissions('customers:view')
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

  /** GET /customers/:id/financial-summary — current/last month paid, due, bottles. */
  @Get(':id/financial-summary')
  @RequirePermissions('customers:view_financial')
  getFinancialSummary(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.customerService.getFinancialSummary(user.vendorId, id);
  }
}
