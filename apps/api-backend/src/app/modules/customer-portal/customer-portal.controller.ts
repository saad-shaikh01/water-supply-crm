import { Controller, Get, Post, Query, Body, Res } from '@nestjs/common';
import { Response } from 'express';
import { CustomerPortalService } from './customer-portal.service';
import { PortalTransactionsQueryDto } from './dto/portal-transactions-query.dto';
import { PortalDeliveriesQueryDto } from './dto/portal-deliveries-query.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { StatementQueryDto } from '../customer/dto/statement-query.dto';
import { ScheduleQueryDto } from '../customer/dto/schedule-query.dto';
import { RequireCustomer } from '../../common/decorators/authz-markers.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

@Controller('portal')
@RequireCustomer()
export class CustomerPortalController {
  constructor(private readonly portalService: CustomerPortalService) {}

  @Get('me')
  getProfile(@CurrentUser() user: AuthUser) {
    return this.portalService.getProfile(user.userId);
  }

  @Get('balance')
  getBalance(@CurrentUser() user: AuthUser) {
    return this.portalService.getBalance(user.userId);
  }

  @Get('summary')
  getSummary(@CurrentUser() user: AuthUser) {
    return this.portalService.getSummary(user.userId);
  }

  /** GET /portal/payment-info — Vendor's Raast ID + instructions for manual payments */
  @Get('payment-info')
  getPaymentInfo(@CurrentUser() user: AuthUser) {
    return this.portalService.getVendorPaymentInfo(user.userId);
  }

  @Get('transactions')
  getTransactions(
    @CurrentUser() user: AuthUser,
    @Query() query: PortalTransactionsQueryDto,
  ) {
    return this.portalService.getTransactions(user.userId, query);
  }

  @Get('deliveries')
  getDeliveries(
    @CurrentUser() user: AuthUser,
    @Query() query: PortalDeliveriesQueryDto,
  ) {
    return this.portalService.getDeliveries(user.userId, query);
  }

  /** GET /portal/statement?month=2026-01 — customer statement PDF */
  @Get('statement')
  async getStatement(
    @CurrentUser() user: AuthUser,
    @Query() query: StatementQueryDto,
    @Res() res: Response,
  ) {
    const buffer = await this.portalService.getStatement(user.userId, query.month);
    const month = query.month ?? new Date().toISOString().slice(0, 7);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="statement-${month}.pdf"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  /** GET /portal/schedule?from=2026-02-01&to=2026-02-28 — delivery calendar */
  @Get('schedule')
  getSchedule(@CurrentUser() user: AuthUser, @Query() query: ScheduleQueryDto) {
    return this.portalService.getSchedule(user.userId, query.from, query.to);
  }

  @Get('products')
  getProducts(@CurrentUser() user: AuthUser) {
    return this.portalService.getProducts(user.userId);
  }

  @Post('change-password')
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.portalService.changePassword(
      user.userId,
      dto.currentPassword,
      dto.newPassword,
    );
  }
}
