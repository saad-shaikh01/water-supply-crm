import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { LedgerService } from './ledger.service';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { RecordAdjustmentDto } from './dto/record-adjustment.dto';
import { TransactionQueryDto } from './dto/transaction-query.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { NotificationService } from '../notifications/notification.service';

@Controller('transactions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TransactionController {
  constructor(
    private readonly ledgerService: LedgerService,
    private readonly notificationService: NotificationService,
  ) {}

  @Get()
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  findAll(@CurrentUser() user: any, @Query() query: TransactionQueryDto) {
    return this.ledgerService.findAllPaginated(user.vendorId, query);
  }

  /**
   * GET /transactions/summary
   * Aggregate summary for the active filter window.
   * Accepts the same query params as GET /transactions (except page/limit/type).
   * Returns: { totalCharges, totalCollections, totalAdjustments, chargeCount, paymentCount, adjustmentCount, totalCount, net }
   */
  @Get('summary')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  getSummary(@CurrentUser() user: any, @Query() query: TransactionQueryDto) {
    return this.ledgerService.getTransactionSummary(user.vendorId, query);
  }

  @Post('payments')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 30 } })
  async recordPayment(@CurrentUser() user: any, @Body() dto: RecordPaymentDto) {
    const transaction = await this.ledgerService.recordPayment(
      user.vendorId,
      dto,
    );

    if (transaction.customer?.phoneNumber) {
      const message = `Payment of ${dto.amount} received. New balance: ${transaction.customer.financialBalance}. Thank you!`;
      await this.notificationService
        .queueWhatsApp(transaction.customer.phoneNumber, message)
        .catch(() => {});
    }

    return transaction;
  }

  @Post('adjustments')
  @Roles(UserRole.VENDOR_ADMIN)
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  recordAdjustment(
    @CurrentUser() user: any,
    @Body() dto: RecordAdjustmentDto,
  ) {
    return this.ledgerService.recordAdjustment(user.vendorId, dto);
  }

  @Get('customers/:customerId')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF, UserRole.DRIVER)
  findByCustomer(
    @CurrentUser() user: any,
    @Param('customerId') customerId: string,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.ledgerService.findByCustomer(
      user.vendorId,
      customerId,
      pagination,
    );
  }

  @Get('customers/:customerId/summary')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF, UserRole.DRIVER)
  getCustomerSummary(
    @CurrentUser() user: any,
    @Param('customerId') customerId: string,
  ) {
    return this.ledgerService.getCustomerLedgerSummary(
      user.vendorId,
      customerId,
    );
  }
}
