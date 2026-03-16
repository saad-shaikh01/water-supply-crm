import { ConflictException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { CACHE_KEYS, CacheInvalidationService } from '@water-supply-crm/caching';
import { CustomerService } from './customer.service';
import { AuditService } from '../audit/audit.service';
import { CustomerStatementPdfService } from './pdf/customer-statement-pdf.service';
import {
  createMockCustomer,
  createMockUser,
  createPrismaMock,
  createPrismaProvider,
  createTestModule,
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
});
