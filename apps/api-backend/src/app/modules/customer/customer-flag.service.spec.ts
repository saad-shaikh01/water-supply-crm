import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CustomerFlagService } from './customer-flag.service';

const VENDOR_ID = 'vendor-1';
const USER = { vendorId: VENDOR_ID, userId: 'user-1', name: 'Manager' } as any;

const CUSTOMER = { id: 'cust-1', vendorId: VENDOR_ID, name: 'Ali Water Shop' };
const CATEGORY = {
  id: 'cat-1',
  vendorId: VENDOR_ID,
  name: 'Payment Overdue',
  color: '#f59e0b',
  defaultMessage: 'Outstanding balance needs collecting',
  isActive: true,
};

function makeService(overrides: { flags?: any[]; category?: any; customer?: any } = {}) {
  const flags = overrides.flags ?? [];
  const category = overrides.category === undefined ? CATEGORY : overrides.category;
  const customer = overrides.customer === undefined ? CUSTOMER : overrides.customer;

  const prisma: any = {
    customer: {
      findFirst: jest.fn(async ({ where }: any) =>
        customer && customer.id === where.id && customer.vendorId === where.vendorId ? customer : null,
      ),
    },
    customerFlagCategory: {
      findFirst: jest.fn(async ({ where }: any) =>
        category && category.id === where.id && category.vendorId === where.vendorId && category.isActive
          ? category
          : null,
      ),
    },
    customerFlag: {
      findFirst: jest.fn(async ({ where }: any) =>
        flags.find(
          (f) =>
            (where.id ? f.id === where.id : true) &&
            (where.customerId ? f.customerId === where.customerId : true) &&
            (where.categoryId ? f.categoryId === where.categoryId : true) &&
            (where.vendorId ? f.vendorId === where.vendorId : true) &&
            (where.status ? f.status === where.status : true),
        ) ?? null,
      ),
      create: jest.fn(async ({ data }: any) => ({
        id: 'flag-1',
        status: 'OPEN',
        createdAt: new Date(),
        category,
        ...data,
      })),
      update: jest.fn(async ({ where, data }: any) => ({
        ...flags.find((f) => f.id === where.id),
        ...data,
        category,
      })),
      findMany: jest.fn(async () => flags),
    },
  };
  const audit: any = { log: jest.fn(async () => undefined) };
  const cache: any = { invalidateVendorEntity: jest.fn(async () => undefined) };
  return { service: new CustomerFlagService(prisma, audit, cache), prisma, audit, cache };
}

describe('CustomerFlagService', () => {
  describe('apply', () => {
    it('applies a flag using the category default message and audit-logs it', async () => {
      const { service, prisma, audit, cache } = makeService();
      const flag = await service.apply(USER, 'cust-1', { categoryId: 'cat-1' });
      expect(flag).toMatchObject({ message: 'Outstanding balance needs collecting', category: CATEGORY });
      expect(prisma.customerFlag.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            vendorId: VENDOR_ID,
            customerId: 'cust-1',
            categoryId: 'cat-1',
            message: 'Outstanding balance needs collecting',
            createdById: 'user-1',
            createdByName: 'Manager',
          }),
        }),
      );
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'FLAGGED', entity: 'CustomerFlag' }));
      expect(cache.invalidateVendorEntity).toHaveBeenCalled();
    });

    it('uses a custom message override instead of the category default', async () => {
      const { service } = makeService();
      const flag = await service.apply(USER, 'cust-1', { categoryId: 'cat-1', message: 'Owes 3 months, refuses to pay' });
      expect(flag.message).toBe('Owes 3 months, refuses to pay');
    });

    it('404s for an unknown customer', async () => {
      const { service } = makeService({ customer: null });
      await expect(service.apply(USER, 'nope', { categoryId: 'cat-1' })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('400s for an unknown or inactive category', async () => {
      const { service } = makeService({ category: null });
      await expect(service.apply(USER, 'cust-1', { categoryId: 'nope' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('400s when neither a custom message nor a category default message exists', async () => {
      const { service } = makeService({ category: { ...CATEGORY, defaultMessage: null } });
      await expect(service.apply(USER, 'cust-1', { categoryId: 'cat-1' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('refuses a duplicate OPEN flag for the same category', async () => {
      const { service, prisma } = makeService({
        flags: [{ id: 'f1', vendorId: VENDOR_ID, customerId: 'cust-1', categoryId: 'cat-1', status: 'OPEN' }],
      });
      await expect(service.apply(USER, 'cust-1', { categoryId: 'cat-1' })).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.customerFlag.create).not.toHaveBeenCalled();
    });
  });

  describe('resolve', () => {
    it('resolves an OPEN flag and audit-logs it', async () => {
      const openFlag = {
        id: 'f1',
        vendorId: VENDOR_ID,
        customerId: 'cust-1',
        categoryId: 'cat-1',
        status: 'OPEN',
        category: CATEGORY,
        customer: { name: CUSTOMER.name },
      };
      const { service, prisma, audit, cache } = makeService({ flags: [openFlag] });
      const resolved = await service.resolve(USER, 'cust-1', 'f1', { resolvedReason: 'Customer cleared the balance' });
      expect(resolved).toMatchObject({ status: 'RESOLVED', resolvedReason: 'Customer cleared the balance' });
      expect(prisma.customerFlag.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'f1' },
          data: expect.objectContaining({
            status: 'RESOLVED',
            resolvedById: 'user-1',
            resolvedByName: 'Manager',
            resolvedReason: 'Customer cleared the balance',
          }),
        }),
      );
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'RESOLVED' }));
      expect(cache.invalidateVendorEntity).toHaveBeenCalled();
    });

    it('404s for an unknown flag', async () => {
      const { service } = makeService({ flags: [] });
      await expect(service.resolve(USER, 'cust-1', 'nope', {})).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses to resolve an already-resolved flag', async () => {
      const resolvedFlag = {
        id: 'f1',
        vendorId: VENDOR_ID,
        customerId: 'cust-1',
        categoryId: 'cat-1',
        status: 'RESOLVED',
        category: CATEGORY,
        customer: { name: CUSTOMER.name },
      };
      const { service } = makeService({ flags: [resolvedFlag] });
      await expect(service.resolve(USER, 'cust-1', 'f1', {})).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
