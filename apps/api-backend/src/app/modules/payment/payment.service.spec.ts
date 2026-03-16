import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  PaymentMethod,
  PaymentRequestStatus,
} from '@prisma/client';
import { PaymentService } from './payment.service';
import { PAYMENT_PROVIDER } from './providers/payment-provider.interface';
import { AuditService } from '../audit/audit.service';
import { FcmService } from '../fcm/fcm.service';
import { NotificationService } from '../notifications/notification.service';
import { LedgerService } from '../transaction/ledger.service';
import {
  createMockCustomer,
  createPrismaMock,
  createPrismaProvider,
  createTestModule,
  mockVendorId,
  PrismaMock,
} from '../../../test';

describe('PaymentService', () => {
  let service: PaymentService;
  let prisma: PrismaMock;
  let gateway: {
    createRaastQr: jest.Mock;
    verifyWebhook: jest.Mock;
  };
  let ledger: { recordPayment: jest.Mock };
  let notifications: { queueWhatsApp: jest.Mock };
  let audit: { log: jest.Mock };
  let fcm: { sendToCustomer: jest.Mock; sendToVendorUsers: jest.Mock };

  beforeEach(async () => {
    prisma = createPrismaMock();
    gateway = {
      createRaastQr: jest.fn(),
      verifyWebhook: jest.fn(),
    };
    ledger = {
      recordPayment: jest.fn().mockResolvedValue(undefined),
    };
    notifications = {
      queueWhatsApp: jest.fn().mockResolvedValue(undefined),
    };
    audit = {
      log: jest.fn().mockResolvedValue(undefined),
    };
    fcm = {
      sendToCustomer: jest.fn().mockResolvedValue({ sent: 1, failed: 0 }),
      sendToVendorUsers: jest.fn().mockResolvedValue({ sent: 1, failed: 0 }),
    };

    const module = await createTestModule({
      providers: [
        PaymentService,
        createPrismaProvider(prisma),
        { provide: PAYMENT_PROVIDER, useValue: gateway },
        { provide: LedgerService, useValue: ledger },
        { provide: NotificationService, useValue: notifications },
        { provide: AuditService, useValue: audit },
        { provide: FcmService, useValue: fcm },
      ],
    });

    service = module.get(PaymentService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initiateRaastQr', () => {
    it('creates a pending request, opens a gateway session, and returns the processing response', async () => {
      const customer = {
        ...createMockCustomer({
          id: 'customer-1',
          vendorId: mockVendorId,
          customerCode: 'CUST-100',
          name: 'Ali Khan',
          phoneNumber: '03001234567',
        }),
        vendor: { id: mockVendorId, name: 'Test Water Co.' },
      };
      prisma.customer.findUnique.mockResolvedValue(customer as never);
      prisma.paymentRequest.create.mockResolvedValue({
        id: 'payment-request-1',
        vendorId: mockVendorId,
        customerId: 'customer-1',
        amount: 1500,
        method: PaymentMethod.RAAST_QR,
        status: PaymentRequestStatus.PENDING,
      } as never);
      gateway.createRaastQr.mockResolvedValue({
        gatewayOrderId: 'paymob-order-1',
        checkoutUrl: 'https://gateway.example/checkout/1',
        qrCodeData: 'qr-data',
        expiresAt: new Date('2025-01-01T12:15:00.000Z'),
      });
      prisma.paymentRequest.update.mockResolvedValue({
        id: 'payment-request-1',
        amount: 1500,
        checkoutUrl: 'https://gateway.example/checkout/1',
        qrCodeData: 'qr-data',
        qrExpiresAt: new Date('2025-01-01T12:15:00.000Z'),
        status: PaymentRequestStatus.PROCESSING,
      } as never);

      const result = await service.initiateRaastQr('customer-1', {
        amount: 1500,
        method: PaymentMethod.RAAST_QR,
      });

      expect(prisma.paymentRequest.create).toHaveBeenCalledWith({
        data: {
          vendorId: mockVendorId,
          customerId: 'customer-1',
          amount: 1500,
          method: PaymentMethod.RAAST_QR,
          status: PaymentRequestStatus.PENDING,
        },
      });
      expect(gateway.createRaastQr).toHaveBeenCalledWith({
        orderId: 'payment-request-1',
        amountPkr: 1500,
        customerName: 'Ali Khan',
        customerPhone: '03001234567',
        description: expect.stringContaining('CUST-100'),
      });
      expect(result).toEqual(
        expect.objectContaining({
          paymentRequestId: 'payment-request-1',
          status: PaymentRequestStatus.PROCESSING,
          checkoutUrl: 'https://gateway.example/checkout/1',
          amount: 1500,
        }),
      );
    });

    it('rejects non-QR payment methods on the QR initiation endpoint', async () => {
      prisma.customer.findUnique.mockResolvedValue(
        createMockCustomer({ id: 'customer-1' }) as never,
      );

      await expect(
        service.initiateRaastQr('customer-1', {
          amount: 1500,
          method: PaymentMethod.MANUAL_BANK,
        }),
      ).rejects.toThrow(
        new BadRequestException('Use /manual for non-QR payment methods'),
      );
    });
  });

  describe('submitManualPayment', () => {
    it('creates a pending manual request and notifies vendor users', async () => {
      prisma.customer.findUnique.mockResolvedValue(
        createMockCustomer({
          id: 'customer-1',
          vendorId: mockVendorId,
          name: 'Ali Khan',
        }) as never,
      );
      prisma.paymentRequest.create.mockResolvedValue({
        id: 'payment-request-2',
        amount: 900,
        referenceNo: 'REF-12345',
        status: PaymentRequestStatus.PENDING,
      } as never);

      const result = await service.submitManualPayment(
        'customer-1',
        {
          amount: 900,
          method: PaymentMethod.MANUAL_BANK,
          referenceNo: 'REF-12345',
          customerNote: 'Transferred from HBL',
        },
        'uploads/proof.png',
      );

      await Promise.resolve();

      expect(prisma.paymentRequest.create).toHaveBeenCalledWith({
        data: {
          vendorId: mockVendorId,
          customerId: 'customer-1',
          amount: 900,
          method: PaymentMethod.MANUAL_BANK,
          status: PaymentRequestStatus.PENDING,
          referenceNo: 'REF-12345',
          screenshotPath: 'uploads/proof.png',
          customerNote: 'Transferred from HBL',
        },
      });
      expect(fcm.sendToVendorUsers).toHaveBeenCalledWith(
        mockVendorId,
        expect.stringContaining('New Payment Request'),
        expect.stringContaining('Ali Khan'),
        expect.objectContaining({
          requestId: 'payment-request-2',
        }),
      );
      expect(result).toEqual(
        expect.objectContaining({
          paymentRequestId: 'payment-request-2',
          status: PaymentRequestStatus.PENDING,
          referenceNo: 'REF-12345',
        }),
      );
    });
  });

  describe('getPaymentStatus', () => {
    it('auto-expires stale QR requests based on qrExpiresAt', async () => {
      prisma.paymentRequest.findFirst.mockResolvedValue({
        id: 'payment-request-3',
        customerId: 'customer-1',
        status: PaymentRequestStatus.PROCESSING,
        qrExpiresAt: new Date('2025-01-01T00:00:00.000Z'),
      } as never);
      prisma.paymentRequest.update.mockResolvedValue({
        id: 'payment-request-3',
        status: PaymentRequestStatus.EXPIRED,
      } as never);

      const result = await service.getPaymentStatus(
        'customer-1',
        'payment-request-3',
      );

      expect(prisma.paymentRequest.update).toHaveBeenCalledWith({
        where: { id: 'payment-request-3' },
        data: { status: PaymentRequestStatus.EXPIRED },
      });
      expect(result.status).toBe(PaymentRequestStatus.EXPIRED);
    });
  });

  describe('approvePayment', () => {
    it('records the ledger entry, marks the request approved, and notifies the customer', async () => {
      prisma.paymentRequest.findFirst.mockResolvedValue({
        id: 'payment-request-4',
        vendorId: mockVendorId,
        customerId: 'customer-1',
        amount: 1200,
        method: PaymentMethod.MANUAL_BANK,
        referenceNo: 'REF-444',
        gatewayTxId: null,
        status: PaymentRequestStatus.PENDING,
        customer: {
          name: 'Ali Khan',
          phoneNumber: '03001234567',
          financialBalance: 5000,
        },
      } as never);
      prisma.paymentRequest.update.mockResolvedValue({
        id: 'payment-request-4',
        status: PaymentRequestStatus.APPROVED,
      } as never);

      const result = await service.approvePayment(
        mockVendorId,
        'payment-request-4',
        'reviewer-1',
      );

      await Promise.resolve();

      expect(ledger.recordPayment).toHaveBeenCalledWith(
        mockVendorId,
        expect.objectContaining({
          customerId: 'customer-1',
          amount: 1200,
          description: expect.stringContaining('REF-444'),
        }),
      );
      expect(prisma.paymentRequest.update).toHaveBeenCalledWith({
        where: { id: 'payment-request-4' },
        data: {
          status: PaymentRequestStatus.APPROVED,
          reviewedBy: 'reviewer-1',
          reviewedAt: expect.any(Date),
        },
      });
      expect(notifications.queueWhatsApp).toHaveBeenCalledWith(
        '03001234567',
        expect.any(String),
        'ntf:payment.approved:payment-request-4:wa',
      );
      expect(fcm.sendToCustomer).toHaveBeenCalledWith(
        'customer-1',
        expect.stringContaining('Approved'),
        expect.stringContaining('Rs. 1200'),
        expect.objectContaining({
          type: 'PAYMENT_APPROVED',
          requestId: 'payment-request-4',
        }),
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          vendorId: mockVendorId,
          userId: 'reviewer-1',
          action: 'APPROVE',
          entity: 'Payment',
          entityId: 'payment-request-4',
        }),
      );
      expect(result).toEqual({
        message: 'Payment approved and recorded in ledger',
        requestId: 'payment-request-4',
        amount: 1200,
        newBalance: 3800,
      });
    });

    it('rejects attempts to approve an already approved payment', async () => {
      prisma.paymentRequest.findFirst.mockResolvedValue({
        id: 'payment-request-4',
        vendorId: mockVendorId,
        customerId: 'customer-1',
        amount: 1200,
        status: PaymentRequestStatus.APPROVED,
        customer: {
          name: 'Ali Khan',
          phoneNumber: '03001234567',
          financialBalance: 5000,
        },
      } as never);

      await expect(
        service.approvePayment(mockVendorId, 'payment-request-4', 'reviewer-1'),
      ).rejects.toThrow(new ConflictException('Payment already approved'));
      expect(ledger.recordPayment).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the request is not found for the vendor', async () => {
      prisma.paymentRequest.findFirst.mockResolvedValue(null);

      await expect(
        service.approvePayment(mockVendorId, 'missing-request', 'reviewer-1'),
      ).rejects.toThrow(new NotFoundException('Payment request not found'));
    });
  });

  describe('handlePaymobWebhook', () => {
    it('returns received without side effects when the gateway payload is invalid', async () => {
      gateway.verifyWebhook.mockReturnValue(null);

      const result = await service.handlePaymobWebhook(
        { any: 'payload' },
        'bad-hmac',
      );

      expect(prisma.paymentRequest.findFirst).not.toHaveBeenCalled();
      expect(ledger.recordPayment).not.toHaveBeenCalled();
      expect(result).toEqual({ received: true });
    });

    it('marks the request as PAID, records the ledger entry, and queues WhatsApp on success', async () => {
      gateway.verifyWebhook.mockReturnValue({
        gatewayOrderId: 'paymob-order-1',
        gatewayTxId: 'gateway-tx-1',
        amountCents: 150000,
        success: true,
        rawPayload: { id: 'txn-1' },
      });
      prisma.paymentRequest.findFirst.mockResolvedValue({
        id: 'payment-request-1',
        vendorId: mockVendorId,
        customerId: 'customer-1',
        amount: 1500,
        gatewayOrderId: 'paymob-order-1',
        status: PaymentRequestStatus.PROCESSING,
        customer: {
          name: 'Ali Khan',
          phoneNumber: '03001234567',
          financialBalance: 5000,
        },
      } as never);
      prisma.paymentRequest.update.mockResolvedValue({
        id: 'payment-request-1',
        status: PaymentRequestStatus.PAID,
      } as never);

      const result = await service.handlePaymobWebhook(
        { any: 'payload' },
        'valid-hmac',
      );

      expect(ledger.recordPayment).toHaveBeenCalledWith(
        mockVendorId,
        expect.objectContaining({
          customerId: 'customer-1',
          amount: 1500,
          description: expect.stringContaining('gateway-tx-1'),
        }),
      );
      expect(prisma.paymentRequest.update).toHaveBeenCalledWith({
        where: { id: 'payment-request-1' },
        data: {
          status: PaymentRequestStatus.PAID,
          gatewayTxId: 'gateway-tx-1',
          reviewedAt: expect.any(Date),
        },
      });
      expect(notifications.queueWhatsApp).toHaveBeenCalledWith(
        '03001234567',
        expect.any(String),
        'ntf:payment.approved:payment-request-1:wa',
      );
      expect(result).toEqual({ received: true });
    });

    it('returns received without recording duplicate payments for already settled requests', async () => {
      gateway.verifyWebhook.mockReturnValue({
        gatewayOrderId: 'paymob-order-1',
        gatewayTxId: 'gateway-tx-1',
        amountCents: 150000,
        success: true,
        rawPayload: { id: 'txn-1' },
      });
      prisma.paymentRequest.findFirst.mockResolvedValue({
        id: 'payment-request-1',
        vendorId: mockVendorId,
        customerId: 'customer-1',
        amount: 1500,
        gatewayOrderId: 'paymob-order-1',
        status: PaymentRequestStatus.APPROVED,
        customer: {
          name: 'Ali Khan',
          phoneNumber: '03001234567',
          financialBalance: 5000,
        },
      } as never);

      const result = await service.handlePaymobWebhook(
        { any: 'payload' },
        'valid-hmac',
      );

      expect(ledger.recordPayment).not.toHaveBeenCalled();
      expect(prisma.paymentRequest.update).not.toHaveBeenCalled();
      expect(result).toEqual({ received: true });
    });
  });
});
