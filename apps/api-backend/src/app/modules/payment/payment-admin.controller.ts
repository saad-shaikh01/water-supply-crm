import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
  Query,
  NotFoundException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PaymentService } from './payment.service';
import { PaymentQueryDto } from './dto/payment-query.dto';
import { ApprovePaymentDto, RejectPaymentDto } from './dto/review-payment.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';
import { StorageService } from '../../common/storage/storage.service';

// Reads require payments:view (class-level); approve/reject override with their own perms.
@Controller('payment-requests')
@RequirePermissions('payments:view')
export class PaymentAdminController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly storage: StorageService,
  ) {}

  /**
   * GET /payment-requests
   * List all payment requests for this vendor (paginated + filtered).
   * Query: status, customerId, page, limit
   */
  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query() query: PaymentQueryDto) {
    return this.paymentService.findAllByVendor(user.vendorId, query);
  }

  /**
   * GET /payment-requests/:id
   * Get detail of a single payment request.
   */
  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.paymentService.findOneByVendor(user.vendorId, id);
  }

  /**
   * GET /payment-requests/:id/screenshot
   * Generate a short-lived signed URL (15 min) for the payment screenshot.
   * Returns: { signedUrl }
   */
  @Get(':id/screenshot')
  async getScreenshot(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const request = await this.paymentService.findOneByVendor(user.vendorId, id);
    if (!request.screenshotPath) {
      throw new NotFoundException('No screenshot attached to this payment request');
    }
    const signedUrl = await this.storage.getSignedUrl(request.screenshotPath);
    return { signedUrl };
  }

  /**
   * PATCH /payment-requests/:id/approve
   * Approve a manual payment → auto-records in ledger + sends WhatsApp.
   * Only VENDOR_ADMIN can approve.
   */
  @Patch(':id/approve')
  @RequirePermissions('payments:approve')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 20 } })
  approve(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() _dto: ApprovePaymentDto,
  ) {
    return this.paymentService.approvePayment(user.vendorId, id, user.userId);
  }

  /**
   * PATCH /payment-requests/:id/reject
   * Reject a manual payment with a reason → sends WhatsApp to customer.
   * Only VENDOR_ADMIN can reject.
   */
  @Patch(':id/reject')
  @RequirePermissions('payments:reject')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 20 } })
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: RejectPaymentDto,
  ) {
    return this.paymentService.rejectPayment(
      user.vendorId,
      id,
      user.userId,
      dto.reason,
    );
  }
}
