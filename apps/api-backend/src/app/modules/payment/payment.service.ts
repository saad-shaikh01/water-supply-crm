import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { PaymentRequestStatus, PaymentMethod } from '@prisma/client';
import { paginate } from '../../common/helpers/paginate';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { PaymentQueryDto } from './dto/payment-query.dto';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';
import { SubmitManualPaymentDto } from './dto/submit-manual-payment.dto';
import {
  IPaymentProvider,
  PAYMENT_PROVIDER,
} from './providers/payment-provider.interface';
import { LedgerService } from '../transaction/ledger.service';
import { NotificationService } from '../notifications/notification.service';
import { MessageTemplates } from '../whatsapp/templates/message.templates';
import { AuditService } from '../audit/audit.service';
import { FcmService } from '../fcm/fcm.service';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_PROVIDER) private readonly gateway: IPaymentProvider,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
    private readonly fcm: FcmService,
  ) {}

  // ──────────────────────────────────────────────────────────────────────────
  // CUSTOMER PORTAL — initiate & submit
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Initiate a Raast QR payment.
   * Customer clicks "Pay with Raast" → we create a gateway session → return checkout URL.
   */
  async initiateRaastQr(customerId: string, dto: InitiatePaymentDto) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: { vendor: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    if (dto.method !== PaymentMethod.RAAST_QR) {
      throw new BadRequestException('Use /manual for non-QR payment methods');
    }

    if (dto.amount <= 0) {
      throw new BadRequestException('Amount must be positive');
    }

    // Create pending payment request first (get our ID)
    const request = await this.prisma.paymentRequest.create({
      data: {
        vendorId: customer.vendorId,
        customerId,
        amount: dto.amount,
        method: PaymentMethod.RAAST_QR,
        status: PaymentRequestStatus.PENDING,
      },
    });

    // Call Paymob to create QR session
    const qrResult = await this.gateway.createRaastQr({
      orderId: request.id,
      amountPkr: dto.amount,
      customerName: customer.name,
      customerPhone: customer.phoneNumber,
      description: `Payment for ${customer.vendor.name} — ${customer.customerCode}`,
    });

    // Update request with gateway data
    const updated = await this.prisma.paymentRequest.update({
      where: { id: request.id },
      data: {
        status: PaymentRequestStatus.PROCESSING,
        gatewayOrderId: qrResult.gatewayOrderId,
        checkoutUrl: qrResult.checkoutUrl,
        qrCodeData: qrResult.qrCodeData ?? null,
        qrExpiresAt: qrResult.expiresAt,
      },
    });

    return {
      paymentRequestId: updated.id,
      checkoutUrl: updated.checkoutUrl,
      qrCodeData: updated.qrCodeData,
      qrExpiresAt: updated.qrExpiresAt,
      amount: updated.amount,
      status: updated.status,
      instructions:
        'Scan the QR code in any Pakistani banking app (HBL, MCB, Meezan, JazzCash, etc.) to complete payment',
    };
  }

  /**
   * Submit a manual payment (customer paid via JazzCash/Easypaisa/IBFT/Raast).
   * Optionally upload a screenshot as proof.
   */
  async submitManualPayment(
    customerId: string,
    dto: SubmitManualPaymentDto,
    screenshotPath?: string,
  ) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    if (dto.amount <= 0) {
      throw new BadRequestException('Amount must be positive');
    }

    const request = await this.prisma.paymentRequest.create({
      data: {
        vendorId: customer.vendorId,
        customerId,
        amount: dto.amount,
        method: dto.method,
        status: PaymentRequestStatus.PENDING,
        referenceNo: dto.referenceNo,
        screenshotPath: screenshotPath ?? null,
        customerNote: dto.customerNote ?? null,
      },
    });

    this.logger.log(
      `Manual payment submitted: ${request.id} — Rs.${dto.amount} via ${dto.method}`,
    );

    return {
      paymentRequestId: request.id,
      status: request.status,
      message:
        'Payment submitted successfully. Your vendor will review and approve within 24 hours.',
      amount: request.amount,
      referenceNo: request.referenceNo,
    };
  }

  /** Get single payment request status (customer sees their own) */
  async getPaymentStatus(customerId: string, requestId: string) {
    const request = await this.prisma.paymentRequest.findFirst({
      where: { id: requestId, customerId },
    });
    if (!request) throw new NotFoundException('Payment request not found');

    // Auto-expire stale QR
    if (
      request.status === PaymentRequestStatus.PROCESSING &&
      request.qrExpiresAt &&
      request.qrExpiresAt < new Date()
    ) {
      await this.prisma.paymentRequest.update({
        where: { id: requestId },
        data: { status: PaymentRequestStatus.EXPIRED },
      });
      request.status = PaymentRequestStatus.EXPIRED;
    }

    return request;
  }

  /** Customer's own payment history */
  async getCustomerPaymentHistory(
    customerId: string,
    pagination: PaginationQueryDto,
  ) {
    const { page = 1, limit = 20 } = pagination;
    const where = { customerId };

    const [data, total] = await Promise.all([
      this.prisma.paymentRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.paymentRequest.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // VENDOR ADMIN — review
  // ──────────────────────────────────────────────────────────────────────────

  /** List payment requests for a vendor (with optional filters) */
  async findAllByVendor(vendorId: string, query: PaymentQueryDto) {
    const { page = 1, limit = 20, status, customerId } = query;
    const where: any = { vendorId };
    if (status) where.status = status;
    if (customerId) where.customerId = customerId;

    const [data, total] = await Promise.all([
      this.prisma.paymentRequest.findMany({
        where,
        include: {
          customer: {
            select: { id: true, name: true, customerCode: true, phoneNumber: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.paymentRequest.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  /** Get single payment request detail (vendor) */
  async findOneByVendor(vendorId: string, requestId: string) {
    const request = await this.prisma.paymentRequest.findFirst({
      where: { id: requestId, vendorId },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            customerCode: true,
            phoneNumber: true,
            financialBalance: true,
          },
        },
      },
    });
    if (!request) throw new NotFoundException('Payment request not found');
    return request;
  }

  /** Vendor approves a manual payment → auto-record in ledger + WhatsApp */
  async approvePayment(vendorId: string, requestId: string, reviewedBy: string) {
    const request = await this.prisma.paymentRequest.findFirst({
      where: { id: requestId, vendorId },
      include: {
        customer: {
          select: { name: true, phoneNumber: true, financialBalance: true },
        },
      },
    });
    if (!request) throw new NotFoundException('Payment request not found');

    if (
      request.status === PaymentRequestStatus.APPROVED ||
      request.status === PaymentRequestStatus.PAID
    ) {
      throw new ConflictException('Payment already approved');
    }
    if (request.status === PaymentRequestStatus.REJECTED) {
      throw new ConflictException(
        'Cannot approve a rejected payment. Create a new one.',
      );
    }

    // Record in ledger (decrements financialBalance)
    await this.ledger.recordPayment(vendorId, {
      customerId: request.customerId,
      amount: request.amount,
      description: `Online payment — ${request.method} — Ref: ${request.referenceNo ?? request.gatewayTxId ?? request.id}`,
    });

    const newBalance = request.customer.financialBalance - request.amount;

    // Update payment request status
    await this.prisma.paymentRequest.update({
      where: { id: requestId },
      data: {
        status: PaymentRequestStatus.APPROVED,
        reviewedBy,
        reviewedAt: new Date(),
      },
    });

    // WhatsApp notification to customer
    const message = MessageTemplates.paymentReceived(
      request.customer.name,
      request.amount,
      Math.max(0, newBalance),
    );
    await this.notifications
      .queueWhatsApp(request.customer.phoneNumber, message)
      .catch((e) =>
        this.logger.warn(`WhatsApp notification failed: ${e.message}`),
      );

    this.fcm.sendToCustomer(
      request.customerId,
      'Payment Approved ✅',
      `Rs. ${request.amount} payment approved. New balance: Rs. ${Math.max(0, newBalance)}`,
      { type: 'PAYMENT_APPROVED', requestId },
    ).catch(() => null);

    this.logger.log(
      `Payment approved: ${requestId} Rs.${request.amount} for customer ${request.customerId}`,
    );

    await this.audit.log({
      vendorId,
      userId: reviewedBy,
      action: 'APPROVE',
      entity: 'Payment',
      entityId: requestId,
      changes: { after: { amount: request.amount, customerId: request.customerId } },
    });

    return {
      message: 'Payment approved and recorded in ledger',
      requestId,
      amount: request.amount,
      newBalance: Math.max(0, newBalance),
    };
  }

  /** Vendor rejects a manual payment */
  async rejectPayment(
    vendorId: string,
    requestId: string,
    reviewedBy: string,
    reason: string,
  ) {
    const request = await this.prisma.paymentRequest.findFirst({
      where: { id: requestId, vendorId },
      include: {
        customer: {
          select: { name: true, phoneNumber: true },
        },
      },
    });
    if (!request) throw new NotFoundException('Payment request not found');

    if (
      request.status === PaymentRequestStatus.APPROVED ||
      request.status === PaymentRequestStatus.PAID
    ) {
      throw new ConflictException('Cannot reject an already approved payment');
    }

    await this.prisma.paymentRequest.update({
      where: { id: requestId },
      data: {
        status: PaymentRequestStatus.REJECTED,
        reviewedBy,
        reviewedAt: new Date(),
        rejectionReason: reason,
      },
    });

    // WhatsApp notification
    const message = `Assalam o Alaikum ${request.customer.name},\n\nAfsos! Aapki payment verify nahi ho saki.\n💰 Amount: Rs. ${request.amount}\n❌ Reason: ${reason}\n\nBara payment submit karein ya vendor se rabta karein.`;
    await this.notifications
      .queueWhatsApp(request.customer.phoneNumber, message)
      .catch((e) =>
        this.logger.warn(`WhatsApp notification failed: ${e.message}`),
      );

    await this.audit.log({
      vendorId,
      userId: reviewedBy,
      action: 'REJECT',
      entity: 'Payment',
      entityId: requestId,
      changes: { after: { reason } },
    });

    this.fcm.sendToCustomer(
      request.customerId,
      'Payment Rejected ❌',
      `Rs. ${request.amount} payment rejected. Reason: ${reason}`,
      { type: 'PAYMENT_REJECTED', requestId },
    ).catch(() => null);

    return { message: 'Payment rejected', requestId, reason };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // WEBHOOK — called by Paymob on successful QR payment
  // ──────────────────────────────────────────────────────────────────────────

  async handlePaymobWebhook(payload: any, hmacHeader: string) {
    const parsed = this.gateway.verifyWebhook(payload, hmacHeader);

    if (!parsed) {
      this.logger.warn('Paymob webhook ignored (invalid HMAC or not success)');
      return { received: true };
    }

    const { gatewayOrderId, gatewayTxId, amountCents } = parsed;

    const request = await this.prisma.paymentRequest.findFirst({
      where: { gatewayOrderId },
      include: {
        customer: { select: { name: true, phoneNumber: true, financialBalance: true } },
      },
    });

    if (!request) {
      this.logger.warn(`Webhook: No PaymentRequest found for order ${gatewayOrderId}`);
      return { received: true };
    }

    if (
      request.status === PaymentRequestStatus.PAID ||
      request.status === PaymentRequestStatus.APPROVED
    ) {
      this.logger.warn(`Webhook: duplicate for ${gatewayOrderId} — already processed`);
      return { received: true };
    }

    // Record payment in ledger
    await this.ledger.recordPayment(request.vendorId, {
      customerId: request.customerId,
      amount: request.amount,
      description: `Raast QR payment — TxID: ${gatewayTxId}`,
    });

    const newBalance = request.customer.financialBalance - request.amount;

    await this.prisma.paymentRequest.update({
      where: { id: request.id },
      data: {
        status: PaymentRequestStatus.PAID,
        gatewayTxId,
        reviewedAt: new Date(),
      },
    });

    // WhatsApp confirmation
    const message = MessageTemplates.paymentReceived(
      request.customer.name,
      request.amount,
      Math.max(0, newBalance),
    );
    await this.notifications
      .queueWhatsApp(request.customer.phoneNumber, message)
      .catch((e) =>
        this.logger.warn(`WhatsApp notification failed: ${e.message}`),
      );

    this.logger.log(
      `Webhook processed: ${gatewayOrderId} Rs.${amountCents / 100} PAID`,
    );
    return { received: true };
  }
}
