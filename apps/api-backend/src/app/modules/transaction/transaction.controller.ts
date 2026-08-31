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
import { NotificationType } from '@prisma/client';
import { LedgerService } from './ledger.service';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { EditPaymentDto } from './dto/edit-payment.dto';
import { DeletePaymentDto } from './dto/delete-payment.dto';
import { RecordAdjustmentDto } from './dto/record-adjustment.dto';
import { TransactionQueryDto } from './dto/transaction-query.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';
import { NotificationService } from '../notifications/notification.service';

@Controller('transactions')
export class TransactionController {
  constructor(
    private readonly ledgerService: LedgerService,
    private readonly notificationService: NotificationService,
  ) {}

  @Get()
  @RequirePermissions('transactions:view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: TransactionQueryDto) {
    return this.ledgerService.findAllPaginated(user.vendorId, query);
  }

  @Get('summary')
  @RequirePermissions('transactions:view')
  getSummary(@CurrentUser() user: AuthUser, @Query() query: TransactionQueryDto) {
    return this.ledgerService.getTransactionSummary(user.vendorId, query);
  }

  @Post('payments')
  @RequirePermissions('transactions:record_payment')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 30 } })
  async recordPayment(@CurrentUser() user: AuthUser, @Body() dto: RecordPaymentDto) {
    const transaction = await this.ledgerService.recordPayment(
      user.vendorId,
      dto,
    );

    if (transaction.customer?.phoneNumber) {
      const message = `Payment of ${dto.amount} received. New balance: ${transaction.customer.financialBalance}. Thank you!`;
      await this.notificationService
        .queueWhatsApp(transaction.customer.phoneNumber, message, undefined, {
          vendorId: user.vendorId,
          type: NotificationType.PAYMENT_RECEIVED,
        })
        .catch(() => {});
    }

    return transaction;
  }

  @Patch('payments/:id')
  @RequirePermissions('transactions:edit_payment')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 30 } })
  editPayment(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: EditPaymentDto,
  ) {
    return this.ledgerService.editPayment(user.vendorId, id, dto, user);
  }

  @Delete('payments/:id')
  @RequirePermissions('transactions:delete_payment')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 30 } })
  deletePayment(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: DeletePaymentDto,
  ) {
    return this.ledgerService.deletePayment(user.vendorId, id, dto, user);
  }

  @Post('adjustments')
  @RequirePermissions('transactions:adjust')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  recordAdjustment(
    @CurrentUser() user: AuthUser,
    @Body() dto: RecordAdjustmentDto,
  ) {
    return this.ledgerService.recordAdjustment(user.vendorId, dto);
  }

  // Customer-centric ledger views (surfaced on the customer page) → customers:view,
  // which preserves DRIVER access (driver holds customers:view).
  @Get('customers/:customerId')
  @RequirePermissions('customers:view')
  findByCustomer(
    @CurrentUser() user: AuthUser,
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
  @RequirePermissions('customers:view')
  getCustomerSummary(
    @CurrentUser() user: AuthUser,
    @Param('customerId') customerId: string,
  ) {
    return this.ledgerService.getCustomerLedgerSummary(
      user.vendorId,
      customerId,
    );
  }

  // Monthly snapshot for the "Record Payment" dialog (prev-month outstanding vs.
  // this month's payments) → same permission as recording the payment itself.
  @Get('customers/:customerId/prev-month-outstanding')
  @RequirePermissions('transactions:record_payment')
  getCustomerPrevMonthOutstanding(
    @CurrentUser() user: AuthUser,
    @Param('customerId') customerId: string,
  ) {
    return this.ledgerService.getCustomerPrevMonthOutstanding(
      user.vendorId,
      customerId,
    );
  }
}
