import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { extname } from 'path';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { PaymentService } from './payment.service';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';
import { SubmitManualPaymentDto } from './dto/submit-manual-payment.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { StorageService } from '../../common/storage/storage.service';

@Controller('portal/payments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.CUSTOMER)
export class PaymentPortalController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly storage: StorageService,
  ) {}

  /**
   * POST /portal/payments/raast
   * Initiate a Raast QR payment session.
   * Returns: { checkoutUrl, qrCodeData, qrExpiresAt, paymentRequestId }
   */
  @Post('raast')
  @Throttle({ short: { ttl: 1000, limit: 2 }, medium: { ttl: 60000, limit: 5 } })
  initiateRaast(
    @CurrentUser() user: any,
    @Body() dto: InitiatePaymentDto,
  ) {
    return this.paymentService.initiateRaastQr(user.customerId, dto);
  }

  /**
   * POST /portal/payments/manual
   * Submit a manual payment with reference number + optional screenshot.
   * Body (multipart/form-data):
   *   amount, method, referenceNo, customerNote (optional)
   *   screenshot (optional file, max 5MB) — uploaded to Wasabi object storage
   */
  @Post('manual')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  @UseInterceptors(
    FileInterceptor('screenshot', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
      fileFilter: (_req, file, cb) => {
        const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
        if (allowed.includes(extname(file.originalname).toLowerCase())) {
          cb(null, true);
        } else {
          cb(new Error('Only JPG, PNG, WEBP images are allowed'), false);
        }
      },
    }),
  )
  async submitManual(
    @CurrentUser() user: any,
    @Body() dto: SubmitManualPaymentDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    let screenshotPath: string | undefined;
    if (file) {
      const { url } = await this.storage.upload(
        'payment-screenshots',
        file.buffer,
        file.originalname,
        file.mimetype,
      );
      screenshotPath = url;
    }
    return this.paymentService.submitManualPayment(
      user.customerId,
      dto,
      screenshotPath,
    );
  }

  /**
   * GET /portal/payments/:id
   * Check status of a specific payment request.
   */
  @Get(':id')
  getStatus(@CurrentUser() user: any, @Param('id') id: string) {
    return this.paymentService.getPaymentStatus(user.customerId, id);
  }

  /**
   * GET /portal/payments
   * My payment history (paginated).
   */
  @Get()
  getHistory(
    @CurrentUser() user: any,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.paymentService.getCustomerPaymentHistory(
      user.customerId,
      pagination,
    );
  }
}
