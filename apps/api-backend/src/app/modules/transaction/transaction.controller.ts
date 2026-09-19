import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Logger,
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
import { CloudTemplateNames } from '../whatsapp/templates/cloud-template-names';

@Controller('transactions')
export class TransactionController {
  private readonly logger = new Logger(TransactionController.name);

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
      // Meta-approved `payment_recorded` template — 4 variables ({{1}} name ·
      // {{2}} customer code · {{3}} amount paid · {{4}} current balance).
      // Must be a template, not free text — see cloud-api-templates.md #18.
      const newBalance = transaction.customer.financialBalance;
      await this.notificationService
        .queueWhatsAppTemplate(
          transaction.customer.phoneNumber,
          CloudTemplateNames.PAYMENT_RECORDED,
          [
            transaction.customer.name,
            transaction.customer.customerCode,
            String(dto.amount),
            newBalance.toFixed(2),
          ],
          `ntf-payment-recorded-${transaction.id}-wa`,
          { vendorId: user.vendorId, type: NotificationType.PAYMENT_RECEIVED, recipientType: 'CUSTOMER', recipientId: dto.customerId },
        )
        .catch((e: Error) =>
          this.logger.warn(`payment-recorded WhatsApp failed: ${e.message}`),
        );
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
