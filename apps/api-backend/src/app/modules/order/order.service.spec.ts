import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import {
  DispatchMode,
  DispatchStatus,
  OrderStatus,
} from '@prisma/client';
import { NotificationService } from '../notifications/notification.service';
import { FcmService } from '../fcm/fcm.service';
import { OrderService } from './order.service';
import {
  createMockCustomer,
  createMockOrder,
  createMockProduct,
  createPrismaMock,
  createPrismaProvider,
  createTestModule,
  mockVendorId,
  PrismaMock,
} from '../../../test';

describe('OrderService', () => {
  let service: OrderService;
  let prisma: PrismaMock;
  let notifications: {
    queueWhatsApp: jest.Mock;
    queueFcm: jest.Mock;
  };
  let fcm: {
    sendToVendorUsers: jest.Mock;
    sendToCustomer: jest.Mock;
  };

  beforeEach(async () => {
    prisma = createPrismaMock();
    notifications = {
      queueWhatsApp: jest.fn().mockResolvedValue(undefined),
      queueFcm: jest.fn().mockResolvedValue(undefined),
    };
    fcm = {
      sendToVendorUsers: jest.fn().mockResolvedValue({ sent: 1, failed: 0 }),
      sendToCustomer: jest.fn().mockResolvedValue({ sent: 1, failed: 0 }),
    };

    const module = await createTestModule({
      providers: [
        OrderService,
        createPrismaProvider(prisma),
        { provide: NotificationService, useValue: notifications },
        { provide: FcmService, useValue: fcm },
      ],
    });

    service = module.get(OrderService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createOrder', () => {
    it('creates a pending order for the current customer and vendor product', async () => {
      prisma.customer.findFirst.mockResolvedValue(
        createMockCustomer({
          id: 'customer-1',
          vendorId: mockVendorId,
          userId: 'user-1',
          name: 'Ali Khan',
        }) as never,
      );
      prisma.product.findFirst.mockResolvedValue(
        createMockProduct({
          id: 'product-1',
          vendorId: mockVendorId,
          isActive: true,
        }) as never,
      );
      prisma.customerOrder.create.mockResolvedValue(
        {
          ...createMockOrder({
            id: 'order-1',
            vendorId: mockVendorId,
            customerId: 'customer-1',
            productId: 'product-1',
            quantity: 2,
            status: OrderStatus.PENDING,
          }),
          product: { id: 'product-1', name: '19L Water Bottle', basePrice: 150 },
        } as never,
      );

      const result = await service.createOrder('user-1', {
        productId: 'product-1',
        quantity: 2,
        note: 'Ring the bell',
        preferredDate: '2025-01-10',
      });

      expect(prisma.customerOrder.create).toHaveBeenCalledWith({
        data: {
          vendorId: mockVendorId,
          customerId: 'customer-1',
          productId: 'product-1',
          quantity: 2,
          note: 'Ring the bell',
          preferredDate: new Date('2025-01-10'),
        },
        include: {
          product: { select: { id: true, name: true, basePrice: true } },
        },
      });
      expect(result.status).toBe(OrderStatus.PENDING);
    });

    it('throws NotFoundException when the product is missing or inactive for the vendor', async () => {
      prisma.customer.findFirst.mockResolvedValue(
        createMockCustomer({
          id: 'customer-1',
          vendorId: mockVendorId,
          userId: 'user-1',
        }) as never,
      );
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(
        service.createOrder('user-1', {
          productId: 'missing-product',
          quantity: 1,
        }),
      ).rejects.toThrow(new NotFoundException('Product not found'));
      expect(prisma.customerOrder.create).not.toHaveBeenCalled();
    });
  });

  describe('approveOrder', () => {
    it('writes the approved status with reviewer metadata for a pending order', async () => {
      prisma.customerOrder.findUnique.mockResolvedValue(
        {
          ...createMockOrder({
            id: 'order-1',
            vendorId: mockVendorId,
            status: OrderStatus.PENDING,
            quantity: 2,
          }),
          customer: {
            name: 'Ali Khan',
            phoneNumber: '03001234567',
            userId: 'user-1',
          },
          product: { name: '19L Water Bottle' },
        } as never,
      );
      prisma.customerOrder.update.mockResolvedValue(
        createMockOrder({
          id: 'order-1',
          vendorId: mockVendorId,
          status: OrderStatus.APPROVED,
          reviewedBy: 'reviewer-1',
        }) as never,
      );

      await service.approveOrder(mockVendorId, 'order-1', 'reviewer-1');

      expect(prisma.customerOrder.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: {
          status: OrderStatus.APPROVED,
          reviewedBy: 'reviewer-1',
          reviewedAt: expect.any(Date),
        },
      });
    });
  });

  describe('rejectOrder', () => {
    it('writes the rejected status, reason, and reviewer metadata for a pending order', async () => {
      prisma.customerOrder.findUnique.mockResolvedValue(
        {
          ...createMockOrder({
            id: 'order-1',
            vendorId: mockVendorId,
            status: OrderStatus.PENDING,
          }),
          customer: {
            name: 'Ali Khan',
            phoneNumber: '03001234567',
            userId: 'user-1',
          },
          product: { name: '19L Water Bottle' },
        } as never,
      );
      prisma.customerOrder.update.mockResolvedValue(
        createMockOrder({
          id: 'order-1',
          vendorId: mockVendorId,
          status: OrderStatus.REJECTED,
          rejectionReason: 'Out of stock',
          reviewedBy: 'reviewer-1',
        }) as never,
      );

      await service.rejectOrder(mockVendorId, 'order-1', 'reviewer-1', {
        rejectionReason: 'Out of stock',
      });

      expect(prisma.customerOrder.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: {
          status: OrderStatus.REJECTED,
          rejectionReason: 'Out of stock',
          reviewedBy: 'reviewer-1',
          reviewedAt: expect.any(Date),
        },
      });
    });
  });

  describe('createDispatchPlan', () => {
    const dto = {
      targetDate: '2025-01-11',
      timeWindow: '8-10 AM',
      vanId: '00000000-0000-0000-0000-000000000011',
      driverId: '00000000-0000-0000-0000-000000000012',
      dispatchMode: DispatchMode.QUEUE_FOR_GENERATION,
      notes: 'Morning delivery',
    };

    it('creates a planned dispatch for an approved unplanned order', async () => {
      prisma.customerOrder.findUnique.mockResolvedValue(
        createMockOrder({
          id: 'order-1',
          vendorId: mockVendorId,
          status: OrderStatus.APPROVED,
          dispatchStatus: DispatchStatus.UNPLANNED,
        }) as never,
      );
      prisma.customerOrder.update.mockResolvedValue(
        {
          ...createMockOrder({
            id: 'order-1',
            vendorId: mockVendorId,
            status: OrderStatus.APPROVED,
            dispatchStatus: DispatchStatus.PLANNED,
            dispatchMode: DispatchMode.QUEUE_FOR_GENERATION,
          }),
          customer: { id: 'customer-1', name: 'Ali Khan' },
          product: { id: 'product-1', name: '19L Water Bottle' },
        } as never,
      );

      await service.createDispatchPlan(mockVendorId, 'order-1', dto, 'planner-1');

      expect(prisma.customerOrder.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: {
          dispatchStatus: DispatchStatus.PLANNED,
          targetDate: new Date('2025-01-11'),
          timeWindow: '8-10 AM',
          dispatchVanId: '00000000-0000-0000-0000-000000000011',
          dispatchDriverId: '00000000-0000-0000-0000-000000000012',
          dispatchMode: DispatchMode.QUEUE_FOR_GENERATION,
          dispatchNotes: 'Morning delivery',
          plannedAt: expect.any(Date),
          plannedById: 'planner-1',
        },
        include: {
          customer: { select: { id: true, name: true } },
          product: { select: { id: true, name: true } },
        },
      });
    });

    it('rejects creating a second plan when one already exists', async () => {
      prisma.customerOrder.findUnique.mockResolvedValue(
        createMockOrder({
          id: 'order-1',
          vendorId: mockVendorId,
          status: OrderStatus.APPROVED,
          dispatchStatus: DispatchStatus.PLANNED,
        }) as never,
      );

      await expect(
        service.createDispatchPlan(mockVendorId, 'order-1', dto, 'planner-1'),
      ).rejects.toThrow(
        new BadRequestException(
          'Dispatch plan already exists. Use PATCH to update.',
        ),
      );
      expect(prisma.customerOrder.update).not.toHaveBeenCalled();
    });
  });

  describe('updateDispatchPlan', () => {
    it('rejects replanning after the order is inserted in a sheet', async () => {
      prisma.customerOrder.findUnique.mockResolvedValue(
        createMockOrder({
          id: 'order-1',
          vendorId: mockVendorId,
          status: OrderStatus.APPROVED,
          dispatchStatus: DispatchStatus.INSERTED_IN_SHEET,
        }) as never,
      );

      await expect(
        service.updateDispatchPlan(
          mockVendorId,
          'order-1',
          {
            targetDate: '2025-01-12',
            dispatchMode: DispatchMode.QUEUE_FOR_GENERATION,
          },
          'planner-1',
        ),
      ).rejects.toThrow(
        new BadRequestException(
          'Order is already inserted in a sheet and cannot be re-planned',
        ),
      );
    });
  });

  describe('dispatchNow', () => {
    it('marks an approved order as inserted in sheet and records dispatch metadata', async () => {
      prisma.customerOrder.findUnique.mockResolvedValue(
        createMockOrder({
          id: 'order-1',
          vendorId: mockVendorId,
          status: OrderStatus.APPROVED,
          dispatchStatus: DispatchStatus.PLANNED,
        }) as never,
      );
      prisma.customerOrder.update.mockResolvedValue(
        {
          ...createMockOrder({
            id: 'order-1',
            vendorId: mockVendorId,
            status: OrderStatus.APPROVED,
            dispatchStatus: DispatchStatus.INSERTED_IN_SHEET,
          }),
          customer: { id: 'customer-1', name: 'Ali Khan' },
          product: { id: 'product-1', name: '19L Water Bottle' },
        } as never,
      );

      await service.dispatchNow(mockVendorId, 'order-1', 'dispatcher-1');

      expect(prisma.customerOrder.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: {
          dispatchStatus: DispatchStatus.INSERTED_IN_SHEET,
          dispatchedAt: expect.any(Date),
          plannedById: 'dispatcher-1',
        },
        include: {
          customer: { select: { id: true, name: true } },
          product: { select: { id: true, name: true } },
        },
      });
    });
  });
});
