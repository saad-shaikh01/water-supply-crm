import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { PaymentService } from './payment.service';
import { PaymentQueryDto } from './dto/payment-query.dto';
import { ApprovePaymentDto, RejectPaymentDto } from './dto/review-payment.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('payment-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
export class PaymentAdminController {
  constructor(private readonly paymentService: PaymentService) {}

  /**
   * GET /payment-requests
   * List all payment requests for this vendor (paginated + filtered).
   * Query: status, customerId, page, limit
   */
  @Get()
  findAll(@CurrentUser() user: any, @Query() query: PaymentQueryDto) {
    return this.paymentService.findAllByVendor(user.vendorId, query);
  }

  /**
   * GET /payment-requests/:id
   * Get detail of a single payment request (includes screenshot path).
   */
  @Get(':id')
  findOne(@CurrentUser() user: any, @Param('id') id: string) {
    return this.paymentService.findOneByVendor(user.vendorId, id);
  }

  /**
   * PATCH /payment-requests/:id/approve
   * Approve a manual payment → auto-records in ledger + sends WhatsApp.
   * Only VENDOR_ADMIN can approve.
   */
  @Patch(':id/approve')
  @Roles(UserRole.VENDOR_ADMIN)
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 20 } })
  approve(
    @CurrentUser() user: any,
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
  @Roles(UserRole.VENDOR_ADMIN)
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 20 } })
  reject(
    @CurrentUser() user: any,
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
