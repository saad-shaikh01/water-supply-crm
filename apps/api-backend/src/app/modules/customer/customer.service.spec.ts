import { ConflictException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { CACHE_KEYS, CacheInvalidationService } from '@water-supply-crm/caching';
import { CustomerService } from './customer.service';
import { AuditService } from '../audit/audit.service';
import { CustomerStatementPdfService } from './pdf/customer-statement-pdf.service';
import {
  createMockCustomer,
  createMockProduct,
  createMockUser,
  createPrismaMock,
  createPrismaProvider,
  createTestModule,
  mockPrismaTransaction,
  mockVendorId,
  PrismaMock,
} from '../../../test';

jest.mock('bcrypt');

describe('CustomerService', () => {
  let service: CustomerService;
  let prisma: PrismaMock;
  let cache: { invalidateVendorEntity: jest.Mock };
  let statementPdf: { generate: jest.Mock };
  let audit: { log: jest.Mock };

  beforeEach(async () => {
    prisma = createPrismaMock();
    mockPrismaTransaction(prisma);
    cache = {
      invalidateVendorEntity: jest.fn().mockResolvedValue(undefined),
    };
    statementPdf = {
      generate: jest.fn(),
    };
    audit = {
      log: jest.fn().mockResolvedValue(undefined),
    };

    const module = await createTestModule({
      providers: [
        CustomerService,
        createPrismaProvider(prisma),
        { provide: CacheInvalidationService, useValue: cache },
        { provide: CustomerStatementPdfService, useValue: statementPdf },
        { provide: AuditService, useValue: audit },
      ],
    });

    service = module.get(CustomerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAllPaginated', () => {
    it('applies vendor scoping, active-default filtering, and pagination from the live code', async () => {
      const customers = [
        createMockCustomer({ vendorId: mockVendorId }),
        createMockCustomer({
          id: 'customer-test-002',
          customerCode: 'CUST-002',
          vendorId: mockVendorId,
        }),
      ];
      prisma.customer.findMany.mockResolvedValue(customers as never);
      prisma.customer.count.mockResolvedValue(2);

      const result = await service.findAllPaginated(mockVendorId, {
        page: 1,
        limit: 10,
      });

      expect(prisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { vendorId: mockVendorId, isActive: true },
          skip: 0,
          take: 10,
          orderBy: { name: 'asc' },
        }),
      );
      expect(prisma.customer.count).toHaveBeenCalledWith({
        where: { vendorId: mockVendorId, isActive: true },
      });
      expect(result.meta).toEqual({
        total: 2,
        page: 1,
        limit: 10,
        totalPages: 1,
      });
    });

    it('builds the Prisma where clause for search, route, payment type, and balance range', async () => {
      prisma.customer.findMany.mockResolvedValue([]);
      prisma.customer.count.mockResolvedValue(0);

      await service.findAllPaginated(mockVendorId, {
        page: 2,
        limit: 5,
        search: 'ali',
        routeId: 'route-1',
        paymentType: 'MONTHLY',
        isActive: false,
        balanceMin: 100,
        balanceMax: 500,
        sort: 'createdAt',
        sortDir: 'desc',
      });

      expect(prisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            vendorId: mockVendorId,
            isActive: false,
            routeId: 'route-1',
            paymentType: 'MONTHLY',
            financialBalance: { gte: 100, lte: 500 },
            OR: [
              { name: { contains: 'ali', mode: 'insensitive' } },
              { customerCode: { contains: 'ali', mode: 'insensitive' } },
              { phoneNumber: { contains: 'ali' } },
            ],
          },
          skip: 5,
          take: 5,
          orderBy: { createdAt: 'desc' },
        }),
      );
    });
  });

  describe('createPortalAccount', () => {
    const customerId = 'customer-test-001';
    const dto = {
      email: 'customer.portal@test.com',
      password: 'Secret123!',
    };

    it('creates a CUSTOMER user, links it to the customer, and invalidates the vendor cache', async () => {
      prisma.customer.findFirst.mockResolvedValue(
        createMockCustomer({
          id: customerId,
          vendorId: mockVendorId,
          name: 'Portal Customer',
          phoneNumber: '03001234567',
        }) as never,
      );
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'user-portal-1',
        email: dto.email,
        name: 'Portal Customer',
        phoneNumber: '03001234567',
        role: 'CUSTOMER',
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
      } as never);
      prisma.customer.update.mockResolvedValue(
        createMockCustomer({
          id: customerId,
          userId: 'user-portal-1',
        }) as never,
      );
      (bcrypt.hash as jest.Mock).mockResolvedValue('$2b$10$portal-hash');

      const result = await service.createPortalAccount(
        mockVendorId,
        customerId,
        dto,
      );

      expect(bcrypt.hash).toHaveBeenCalledWith('Secret123!', 10);
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          email: dto.email,
          password: '$2b$10$portal-hash',
          name: 'Portal Customer',
          phoneNumber: '03001234567',
          role: 'CUSTOMER',
        },
        select: {
          id: true,
          email: true,
          name: true,
          phoneNumber: true,
          role: true,
          createdAt: true,
        },
      });
      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: customerId },
        data: { userId: 'user-portal-1' },
      });
      expect(cache.invalidateVendorEntity).toHaveBeenCalledWith(
        mockVendorId,
        CACHE_KEYS.CUSTOMERS,
      );
      expect(result).toEqual({
        message: 'Portal account created',
        user: expect.objectContaining({
          id: 'user-portal-1',
          email: dto.email,
          role: 'CUSTOMER',
        }),
      });
    });

    it('throws NotFoundException when the customer does not belong to the vendor', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.createPortalAccount(mockVendorId, customerId, dto),
      ).rejects.toThrow(new NotFoundException('Customer not found'));
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the customer already has a portal account', async () => {
      prisma.customer.findFirst.mockResolvedValue(
        createMockCustomer({
          id: customerId,
          vendorId: mockVendorId,
          userId: 'existing-user',
        }) as never,
      );

      await expect(
        service.createPortalAccount(mockVendorId, customerId, dto),
      ).rejects.toThrow(
        new ConflictException('Customer already has a portal account'),
      );
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the email is already in use', async () => {
      prisma.customer.findFirst.mockResolvedValue(
        createMockCustomer({
          id: customerId,
          vendorId: mockVendorId,
        }) as never,
      );
      prisma.user.findUnique.mockResolvedValue(
        createMockUser({ email: dto.email }) as never,
      );

      await expect(
        service.createPortalAccount(mockVendorId, customerId, dto),
      ).rejects.toThrow(new ConflictException('Email already in use'));
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('removePortalAccount', () => {
    it('clears the customer link, deletes the user, and invalidates cache', async () => {
      prisma.customer.findFirst.mockResolvedValue(
        createMockCustomer({
          id: 'customer-test-001',
          vendorId: mockVendorId,
          userId: 'user-portal-1',
        }) as never,
      );
      prisma.customer.update.mockResolvedValue(
        createMockCustomer({
          id: 'customer-test-001',
          vendorId: mockVendorId,
          userId: null,
        }) as never,
      );
      prisma.user.delete.mockResolvedValue(
        createMockUser({ id: 'user-portal-1' }) as never,
      );

      const result = await service.removePortalAccount(
        mockVendorId,
        'customer-test-001',
      );

      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: 'customer-test-001' },
        data: { userId: null },
      });
      expect(prisma.user.delete).toHaveBeenCalledWith({
        where: { id: 'user-portal-1' },
      });
      expect(cache.invalidateVendorEntity).toHaveBeenCalledWith(
        mockVendorId,
        CACHE_KEYS.CUSTOMERS,
      );
      expect(result).toEqual({ message: 'Portal account removed' });
    });
  });

  describe('create', () => {
    it('creates the customer, delivery schedules, and wallets using the live transaction flow', async () => {
      const products = [
        createMockProduct({ id: 'product-1' }),
        createMockProduct({ id: 'product-2' }),
      ];
      prisma.vendor.findUnique.mockResolvedValue({ name: 'Blue Water Co' } as never);
      prisma.customer.findFirst.mockResolvedValue({
        customerCode: 'BWC-0007',
      } as never);
      prisma.customer.create.mockResolvedValue(
        createMockCustomer({
          id: 'customer-new-1',
          vendorId: mockVendorId,
          name: 'New Customer',
          customerCode: 'BWC-0008',
          routeId: 'route-1',
        }) as never,
      );
      prisma.customerDeliverySchedule.createMany.mockResolvedValue({
        count: 2,
      } as never);
      prisma.product.findMany.mockResolvedValue(products as never);
      prisma.bottleWallet.create.mockResolvedValue({} as never);

      const result = await service.create(mockVendorId, {
        name: 'New Customer',
        phoneNumber: '03001234567',
        address: '123 Test Street',
        paymentType: 'MONTHLY',
        routeId: 'route-1',
        latitude: 24.8607,
        longitude: 67.0011,
        deliverySchedule: [
          { vanId: 'van-1', dayOfWeek: 1, routeSequence: 1 },
          { vanId: 'van-2', dayOfWeek: 3, routeSequence: 2 },
        ],
      });

      expect(prisma.customer.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'New Customer',
          customerCode: 'BWC-0008',
          vendorId: mockVendorId,
          routeId: 'route-1',
          latitude: 24.8607,
          longitude: 67.0011,
        }),
      });
      expect(prisma.customerDeliverySchedule.createMany).toHaveBeenCalledWith({
        data: [
          {
            customerId: 'customer-new-1',
            vanId: 'van-1',
            dayOfWeek: 1,
            routeSequence: 1,
          },
          {
            customerId: 'customer-new-1',
            vanId: 'van-2',
            dayOfWeek: 3,
            routeSequence: 2,
          },
        ],
      });
      expect(prisma.bottleWallet.create).toHaveBeenCalledTimes(2);
      expect(cache.invalidateVendorEntity).toHaveBeenCalledWith(
        mockVendorId,
        CACHE_KEYS.CUSTOMERS,
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          vendorId: mockVendorId,
          action: 'CREATE',
          entity: 'Customer',
          entityId: 'customer-new-1',
        }),
      );
      expect(result.customerCode).toBe('BWC-0008');
    });

    it('throws ConflictException when a manual customerCode already exists', async () => {
      prisma.customer.findUnique.mockResolvedValue(
        createMockCustomer({ customerCode: 'MANUAL-001' }) as never,
      );

      await expect(
        service.create(mockVendorId, {
          customerCode: 'MANUAL-001',
          name: 'Dup Customer',
          phoneNumber: '03000000000',
          address: '123 Test Street',
          deliverySchedule: [],
        }),
      ).rejects.toThrow(new ConflictException('Customer code already exists'));
    });
  });

  describe('update', () => {
    it('replaces delivery schedules and updates the customer for the current vendor', async () => {
      prisma.customer.findFirst.mockResolvedValue(
        createMockCustomer({
          id: 'customer-test-001',
          vendorId: mockVendorId,
          googleMapsUrl: null,
        }) as never,
      );
      prisma.customerDeliverySchedule.deleteMany.mockResolvedValue({
        count: 1,
      } as never);
      prisma.customerDeliverySchedule.createMany.mockResolvedValue({
        count: 1,
      } as never);
      prisma.customer.update.mockResolvedValue({
        ...createMockCustomer({
          id: 'customer-test-001',
          vendorId: mockVendorId,
          name: 'Updated Name',
        }),
        route: { id: 'route-1', name: 'Route 1' },
        wallets: [],
        deliverySchedules: [],
      } as never);

      const result = await service.update(mockVendorId, 'customer-test-001', {
        name: 'Updated Name',
        deliverySchedule: [{ vanId: 'van-1', dayOfWeek: 2, routeSequence: 5 }],
      });

      expect(prisma.customerDeliverySchedule.deleteMany).toHaveBeenCalledWith({
        where: { customerId: 'customer-test-001' },
      });
      expect(prisma.customerDeliverySchedule.createMany).toHaveBeenCalledWith({
        data: [
          {
            customerId: 'customer-test-001',
            vanId: 'van-1',
            dayOfWeek: 2,
            routeSequence: 5,
          },
        ],
      });
      expect(prisma.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'customer-test-001' },
          data: expect.objectContaining({ name: 'Updated Name' }),
        }),
      );
      expect(cache.invalidateVendorEntity).toHaveBeenCalledWith(
        mockVendorId,
        CACHE_KEYS.CUSTOMERS,
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          vendorId: mockVendorId,
          action: 'UPDATE',
          entity: 'Customer',
          entityId: 'customer-test-001',
        }),
      );
      expect(result.name).toBe('Updated Name');
    });

    it('throws NotFoundException when the customer does not belong to the vendor', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.update(mockVendorId, 'missing-customer', { name: 'Nope' }),
      ).rejects.toThrow(new NotFoundException('Customer not found'));
    });
  });

  describe('setCustomPrice', () => {
    it('upserts the customer-specific product price for the current vendor', async () => {
      prisma.customer.findFirst.mockResolvedValue(
        createMockCustomer({
          id: 'customer-test-001',
          vendorId: mockVendorId,
        }) as never,
      );
      prisma.product.findFirst.mockResolvedValue(
        createMockProduct({
          id: 'product-test-001',
          vendorId: mockVendorId,
        }) as never,
      );
      prisma.customerProductPrice.upsert.mockResolvedValue({
        id: 'price-1',
        customerId: 'customer-test-001',
        productId: 'product-test-001',
        customPrice: 135,
        product: createMockProduct({ id: 'product-test-001' }),
      } as never);

      const result = await service.setCustomPrice(
        mockVendorId,
        'customer-test-001',
        {
          productId: 'product-test-001',
          price: 135,
        },
      );

      expect(prisma.customerProductPrice.upsert).toHaveBeenCalledWith({
        where: {
          customerId_productId: {
            customerId: 'customer-test-001',
            productId: 'product-test-001',
          },
        },
        create: {
          customerId: 'customer-test-001',
          productId: 'product-test-001',
          customPrice: 135,
        },
        update: {
          customPrice: 135,
        },
        include: { product: true },
      });
      expect(cache.invalidateVendorEntity).toHaveBeenCalledWith(
        mockVendorId,
        CACHE_KEYS.CUSTOMERS,
      );
      expect(result.customPrice).toBe(135);
    });

    it('throws NotFoundException when the customer is outside the vendor scope', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.setCustomPrice(mockVendorId, 'missing-customer', {
          productId: 'product-test-001',
          price: 135,
        }),
      ).rejects.toThrow(new NotFoundException('Customer not found'));
    });
  });

  describe('removeCustomPrice', () => {
    it('deletes the customer-specific product price for the current vendor', async () => {
      prisma.customer.findFirst.mockResolvedValue(
        createMockCustomer({
          id: 'customer-test-001',
          vendorId: mockVendorId,
        }) as never,
      );
      prisma.customerProductPrice.delete.mockResolvedValue({} as never);

      const result = await service.removeCustomPrice(
        mockVendorId,
        'customer-test-001',
        'product-test-001',
      );

      expect(prisma.customerProductPrice.delete).toHaveBeenCalledWith({
        where: {
          customerId_productId: {
            customerId: 'customer-test-001',
            productId: 'product-test-001',
          },
        },
      });
      expect(cache.invalidateVendorEntity).toHaveBeenCalledWith(
        mockVendorId,
        CACHE_KEYS.CUSTOMERS,
      );
      expect(result).toEqual({ deleted: true });
    });

    it('throws NotFoundException when the customer is outside the vendor scope', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.removeCustomPrice(
          mockVendorId,
          'missing-customer',
          'product-test-001',
        ),
      ).rejects.toThrow(new NotFoundException('Customer not found'));
    });
  });

  describe('getMonthlyStatement', () => {
    it('calculates opening and closing balances for the requested month', async () => {
      prisma.customer.findFirst.mockResolvedValue(
        createMockCustomer({
          id: 'customer-test-001',
          vendorId: mockVendorId,
          financialBalance: 1000,
        }) as never,
      );
      prisma.transaction.findMany
        .mockResolvedValueOnce([
          { amount: 300, product: { name: '19L Water Bottle' } },
          { amount: -100, product: { name: '19L Water Bottle' } },
          { amount: 50, product: { name: '19L Water Bottle' } },
        ] as never)
        .mockResolvedValueOnce([{ amount: 200 }, { amount: -50 }] as never);

      const result = await service.getMonthlyStatement(
        mockVendorId,
        'customer-test-001',
        '2025-01',
      );

      expect(prisma.transaction.findMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: expect.objectContaining({
            customerId: 'customer-test-001',
            vendorId: mockVendorId,
            createdAt: {
              gte: new Date(2025, 0, 1),
              lt: new Date(2025, 1, 1),
            },
          }),
        }),
      );
      expect(result.openingBalance).toBe(600);
      expect(result.closingBalance).toBe(850);
      expect(result.transactions).toHaveLength(3);
    });

    it('throws NotFoundException when the customer is outside the vendor scope', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.getMonthlyStatement(mockVendorId, 'missing-customer', '2025-01'),
      ).rejects.toThrow(new NotFoundException('Customer not found'));
    });
  });
});
