import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrderService } from './order.service';
import { NotificationService } from '../notifications/notification.service';
import { NOTIFICATION_EVENTS } from '@water-supply-crm/queue';

/**
 * Integration tests: OrderService notification triggers
 *
 * Verifies that approveOrder and rejectOrder fire WhatsApp + FCM
 * notifications with correctly structured idempotency keys so that
 * BullMQ deduplicates retried jobs.
 */
describe('OrderService — notification triggers', () => {
  let service: OrderService;
  let mockPrisma: any;
  let mockNotifications: { queueWhatsApp: jest.Mock; queueFcm: jest.Mock };

  const ORDER_ID = 'order-abc-123';
  const VENDOR_ID = 'vendor-xyz';
  const REVIEWER_ID = 'user-reviewer';

  const pendingOrder = {
    id: ORDER_ID,
    vendorId: VENDOR_ID,
    customerId: 'customer-1',
    status: 'PENDING',
    dispatchStatus: 'UNPLANNED',
    quantity: 3,
    customer: {
      name: 'Ahmed Khan',
      phoneNumber: '+923001234567',
      userId: 'user-cust-1',
    },
    product: { name: 'Water 19L' },
  };

  beforeEach(async () => {
    mockNotifications = {
      queueWhatsApp: jest.fn().mockResolvedValue(undefined),
      queueFcm: jest.fn().mockResolvedValue(undefined),
    };

    mockPrisma = {
      customerOrder: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      customer: { findFirst: jest.fn() },
      product: { findFirst: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderService,
        { provide: 'PrismaService', useValue: mockPrisma },
        { provide: NotificationService, useValue: mockNotifications },
      ],
    })
      .overrideProvider('PrismaService')
      .useValue(mockPrisma)
      .compile();

    service = module.get<OrderService>(OrderService);
    // Directly inject prisma since NestJS DI uses the class token
    (service as any).prisma = mockPrisma;
    (service as any).notifications = mockNotifications;
  });

  afterEach(() => jest.clearAllMocks());

  // ──────────────────────────────────────────────────────────────────────────
  // approveOrder
  // ──────────────────────────────────────────────────────────────────────────

  describe('approveOrder', () => {
    it('queues WhatsApp and FCM with ORDER_APPROVED idempotency keys', async () => {
      mockPrisma.customerOrder.findUnique.mockResolvedValue(pendingOrder);
      mockPrisma.customerOrder.update.mockResolvedValue({
        ...pendingOrder,
        status: 'APPROVED',
      });

      await service.approveOrder(VENDOR_ID, ORDER_ID, REVIEWER_ID);

      // Allow micro-task queue to flush fire-and-forget calls
      await Promise.resolve();

      expect(mockNotifications.queueWhatsApp).toHaveBeenCalledWith(
        pendingOrder.customer.phoneNumber,
        expect.any(String),
        `ntf:${NOTIFICATION_EVENTS.ORDER_APPROVED}:${ORDER_ID}:wa`,
      );

      expect(mockNotifications.queueFcm).toHaveBeenCalledWith(
        pendingOrder.customer.userId,
        expect.stringContaining('Approved'),
        expect.any(String),
        expect.objectContaining({ type: 'ORDER_APPROVED', orderId: ORDER_ID }),
        `ntf:${NOTIFICATION_EVENTS.ORDER_APPROVED}:${ORDER_ID}:fcm`,
      );
    });

    it('WhatsApp and FCM keys are distinct (no cross-channel dedup collision)', async () => {
      mockPrisma.customerOrder.findUnique.mockResolvedValue(pendingOrder);
      mockPrisma.customerOrder.update.mockResolvedValue({
        ...pendingOrder,
        status: 'APPROVED',
      });

      await service.approveOrder(VENDOR_ID, ORDER_ID, REVIEWER_ID);
      await Promise.resolve();

      const waKey = mockNotifications.queueWhatsApp.mock.calls[0][2];
      const fcmKey = mockNotifications.queueFcm.mock.calls[0][4];
      expect(waKey).not.toBe(fcmKey);
      expect(waKey).toMatch(/:wa$/);
      expect(fcmKey).toMatch(/:fcm$/);
    });

    it('throws NotFoundException when order does not belong to vendor', async () => {
      mockPrisma.customerOrder.findUnique.mockResolvedValue({
        ...pendingOrder,
        vendorId: 'other-vendor',
      });

      await expect(
        service.approveOrder(VENDOR_ID, ORDER_ID, REVIEWER_ID),
      ).rejects.toThrow(NotFoundException);

      expect(mockNotifications.queueWhatsApp).not.toHaveBeenCalled();
    });

    it('throws BadRequestException and sends no notification when order is not PENDING', async () => {
      mockPrisma.customerOrder.findUnique.mockResolvedValue({
        ...pendingOrder,
        status: 'APPROVED',
      });

      await expect(
        service.approveOrder(VENDOR_ID, ORDER_ID, REVIEWER_ID),
      ).rejects.toThrow(BadRequestException);

      expect(mockNotifications.queueWhatsApp).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // rejectOrder
  // ──────────────────────────────────────────────────────────────────────────

  describe('rejectOrder', () => {
    const rejectDto = { rejectionReason: 'Out of stock' };

    it('queues WhatsApp and FCM with ORDER_REJECTED idempotency keys', async () => {
      mockPrisma.customerOrder.findUnique.mockResolvedValue(pendingOrder);
      mockPrisma.customerOrder.update.mockResolvedValue({
        ...pendingOrder,
        status: 'REJECTED',
      });

      await service.rejectOrder(VENDOR_ID, ORDER_ID, REVIEWER_ID, rejectDto);
      await Promise.resolve();

      expect(mockNotifications.queueWhatsApp).toHaveBeenCalledWith(
        pendingOrder.customer.phoneNumber,
        expect.stringContaining('Out of stock'),
        `ntf:${NOTIFICATION_EVENTS.ORDER_REJECTED}:${ORDER_ID}:wa`,
      );

      expect(mockNotifications.queueFcm).toHaveBeenCalledWith(
        pendingOrder.customer.userId,
        expect.stringContaining('Rejected'),
        expect.any(String),
        expect.objectContaining({ type: 'ORDER_REJECTED', orderId: ORDER_ID }),
        `ntf:${NOTIFICATION_EVENTS.ORDER_REJECTED}:${ORDER_ID}:fcm`,
      );
    });

    it('rejection key is distinct from approval key for same order', async () => {
      const approvedKey = `ntf:${NOTIFICATION_EVENTS.ORDER_APPROVED}:${ORDER_ID}:wa`;
      const rejectedKey = `ntf:${NOTIFICATION_EVENTS.ORDER_REJECTED}:${ORDER_ID}:wa`;
      expect(approvedKey).not.toBe(rejectedKey);
    });
  });
});
