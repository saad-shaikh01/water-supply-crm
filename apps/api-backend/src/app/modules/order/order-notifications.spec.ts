import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrderService } from './order.service';
import { NotificationService } from '../notifications/notification.service';
import { FcmService } from '../fcm/fcm.service';
import { NOTIFICATION_EVENTS } from '@water-supply-crm/queue';

/**
 * Unit tests: OrderService notification triggers
 *
 * Covers:
 *  - createOrder  → vendor FCM (ORDER_SUBMITTED)
 *  - cancelOrder  → vendor FCM (ORDER_CANCELLED)
 *  - approveOrder → customer WhatsApp + FCM (ORDER_APPROVED, idempotency keys)
 *  - rejectOrder  → customer WhatsApp + FCM (ORDER_REJECTED, idempotency keys)
 */
describe('OrderService — notification triggers', () => {
  let service: OrderService;
  let mockPrisma: any;
  let mockNotifications: { queueWhatsApp: jest.Mock; queueFcm: jest.Mock };
  let mockFcm: { sendToVendorUsers: jest.Mock; sendToCustomer: jest.Mock };

  const ORDER_ID = 'order-abc-123';
  const VENDOR_ID = 'vendor-xyz';
  const REVIEWER_ID = 'user-reviewer';
  const CUSTOMER_ID = 'customer-1';

  const customerRecord = {
    id: CUSTOMER_ID,
    vendorId: VENDOR_ID,
    name: 'Ahmed Khan',
    phoneNumber: '+923001234567',
    userId: 'user-cust-1',
  };

  const pendingOrder = {
    id: ORDER_ID,
    vendorId: VENDOR_ID,
    customerId: CUSTOMER_ID,
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

    mockFcm = {
      sendToVendorUsers: jest.fn().mockResolvedValue({ sent: 2, failed: 0 }),
      sendToCustomer: jest.fn().mockResolvedValue({ sent: 1, failed: 0 }),
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
        { provide: FcmService, useValue: mockFcm },
      ],
    })
      .overrideProvider('PrismaService')
      .useValue(mockPrisma)
      .compile();

    service = module.get<OrderService>(OrderService);
    // Directly inject dependencies since NestJS DI uses class tokens
    (service as any).prisma = mockPrisma;
    (service as any).notifications = mockNotifications;
    (service as any).fcm = mockFcm;
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

  // ──────────────────────────────────────────────────────────────────────────
  // createOrder — vendor staff FCM
  // ──────────────────────────────────────────────────────────────────────────

  describe('createOrder', () => {
    const createDto = { productId: 'product-1', quantity: 2 };
    const createdOrder = {
      id: ORDER_ID,
      vendorId: VENDOR_ID,
      customerId: CUSTOMER_ID,
      quantity: 2,
      product: { id: 'product-1', name: 'Water 19L', basePrice: 150 },
    };

    beforeEach(() => {
      mockPrisma.customer.findFirst.mockResolvedValue(customerRecord);
      mockPrisma.product.findFirst.mockResolvedValue({ id: 'product-1', vendorId: VENDOR_ID, isActive: true });
      mockPrisma.customerOrder.create.mockResolvedValue(createdOrder);
    });

    it('notifies vendor users via FCM with ORDER_SUBMITTED type', async () => {
      await service.createOrder(customerRecord.userId, createDto);
      await Promise.resolve();

      expect(mockFcm.sendToVendorUsers).toHaveBeenCalledWith(
        VENDOR_ID,
        expect.stringContaining('Order'),
        expect.stringContaining('Water 19L'),
        expect.objectContaining({
          type: NOTIFICATION_EVENTS.ORDER_SUBMITTED,
          orderId: ORDER_ID,
        }),
      );
    });

    it('still returns the created order even if FCM throws', async () => {
      mockFcm.sendToVendorUsers.mockRejectedValue(new Error('FCM down'));

      const result = await service.createOrder(customerRecord.userId, createDto);
      await Promise.resolve();

      expect(result).toEqual(createdOrder);
    });

    it('throws NotFoundException when customer not found — no FCM', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(null);

      await expect(service.createOrder('unknown-user', createDto)).rejects.toThrow();
      expect(mockFcm.sendToVendorUsers).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // cancelOrder — vendor staff FCM
  // ──────────────────────────────────────────────────────────────────────────

  describe('cancelOrder', () => {
    beforeEach(() => {
      mockPrisma.customer.findFirst.mockResolvedValue(customerRecord);
      mockPrisma.customerOrder.findUnique.mockResolvedValue(pendingOrder);
      mockPrisma.customerOrder.update.mockResolvedValue({
        ...pendingOrder,
        status: 'CANCELLED',
      });
    });

    it('notifies vendor users via FCM with ORDER_CANCELLED type', async () => {
      await service.cancelOrder(customerRecord.userId, ORDER_ID);
      await Promise.resolve();

      expect(mockFcm.sendToVendorUsers).toHaveBeenCalledWith(
        VENDOR_ID,
        expect.stringContaining('Cancel'),
        expect.stringContaining(customerRecord.name),
        expect.objectContaining({
          type: NOTIFICATION_EVENTS.ORDER_CANCELLED,
          orderId: ORDER_ID,
        }),
      );
    });

    it('ORDER_CANCELLED event is distinct from ORDER_SUBMITTED event', () => {
      expect(NOTIFICATION_EVENTS.ORDER_CANCELLED).not.toBe(NOTIFICATION_EVENTS.ORDER_SUBMITTED);
      expect(NOTIFICATION_EVENTS.ORDER_CANCELLED).toBe('order.cancelled');
    });

    it('throws BadRequestException and sends no FCM when order is not PENDING', async () => {
      mockPrisma.customerOrder.findUnique.mockResolvedValue({
        ...pendingOrder,
        status: 'APPROVED',
      });

      await expect(
        service.cancelOrder(customerRecord.userId, ORDER_ID),
      ).rejects.toThrow(BadRequestException);

      expect(mockFcm.sendToVendorUsers).not.toHaveBeenCalled();
    });

    it('throws NotFoundException and sends no FCM when order belongs to another customer', async () => {
      mockPrisma.customerOrder.findUnique.mockResolvedValue({
        ...pendingOrder,
        customerId: 'other-customer',
      });

      await expect(
        service.cancelOrder(customerRecord.userId, ORDER_ID),
      ).rejects.toThrow(NotFoundException);

      expect(mockFcm.sendToVendorUsers).not.toHaveBeenCalled();
    });
  });
});
