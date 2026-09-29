import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CustomerFlagCategoryService } from './customer-flag-category.service';

const VENDOR_ID = 'vendor-1';
const USER = { vendorId: VENDOR_ID, userId: 'user-1', name: 'Admin' } as any;

const category = (id: string, name: string, overrides: Record<string, any> = {}) => ({
  id,
  vendorId: VENDOR_ID,
  name,
  color: '#ef4444',
  defaultMessage: null,
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

function makeService(overrides: { categories?: any[]; usage?: Record<string, number> } = {}) {
  const categories = overrides.categories ?? [];
  const usage = overrides.usage ?? {};

  const prisma: any = {
    customerFlagCategory: {
      findMany: jest.fn(async ({ where }: any) => categories.filter((c) => c.vendorId === where.vendorId)),
      findFirst: jest.fn(async ({ where }: any) => {
        if (typeof where.id === 'string') {
          return categories.find((c) => c.id === where.id && c.vendorId === where.vendorId) ?? null;
        }
        const wanted = where.name?.equals?.toLowerCase();
        return (
          categories.find(
            (c) =>
              c.vendorId === where.vendorId &&
              c.name.toLowerCase() === wanted &&
              (where.id?.not === undefined || c.id !== where.id.not),
          ) ?? null
        );
      }),
      create: jest.fn(async ({ data }: any) => ({ id: 'new-id', isActive: true, createdAt: new Date(), ...data })),
      update: jest.fn(async ({ where, data }: any) => ({
        ...categories.find((c) => c.id === where.id),
        ...data,
      })),
      delete: jest.fn(async () => ({})),
    },
    customerFlag: {
      groupBy: jest.fn(async () =>
        Object.entries(usage).map(([categoryId, n]) => ({ categoryId, _count: { _all: n } })),
      ),
      count: jest.fn(async ({ where }: any) => usage[where.categoryId] ?? 0),
    },
  };
  const audit: any = { log: jest.fn(async () => undefined) };
  return { service: new CustomerFlagCategoryService(prisma, audit), prisma, audit };
}

describe('CustomerFlagCategoryService', () => {
  describe('list', () => {
    it("returns this vendor's categories with active-flag counts", async () => {
      const { service } = makeService({
        categories: [category('c1', 'To Be Closed'), category('c2', 'Payment Overdue')],
        usage: { c1: 2 },
      });
      const rows = await service.list(VENDOR_ID);
      expect(rows.find((r) => r.id === 'c1')?.activeFlagCount).toBe(2);
      expect(rows.find((r) => r.id === 'c2')?.activeFlagCount).toBe(0);
    });
  });

  describe('create', () => {
    it('creates a trimmed category with color + default message and audit-logs it', async () => {
      const { service, prisma, audit } = makeService();
      const created = await service.create(USER, {
        name: '  To Be Closed  ',
        color: '#ef4444',
        defaultMessage: 'Customer has requested account closure',
      });
      expect(prisma.customerFlagCategory.create).toHaveBeenCalledWith({
        data: {
          vendorId: VENDOR_ID,
          name: 'To Be Closed',
          color: '#ef4444',
          defaultMessage: 'Customer has requested account closure',
        },
      });
      expect(created).toMatchObject({ name: 'To Be Closed', activeFlagCount: 0 });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATED', entity: 'CustomerFlagCategory' }),
      );
    });

    it('rejects a case-insensitive duplicate name', async () => {
      const { service, prisma } = makeService({ categories: [category('c1', 'Payment Overdue')] });
      await expect(
        service.create(USER, { name: 'payment overdue', color: '#f59e0b' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.customerFlagCategory.create).not.toHaveBeenCalled();
    });

    it('rejects a too-short name', async () => {
      const { service } = makeService();
      await expect(service.create(USER, { name: 'A', color: '#f59e0b' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('update', () => {
    it('updates color/message/isActive and audit-logs it', async () => {
      const { service, prisma, audit } = makeService({ categories: [category('c1', 'Payment Overdue')] });
      const updated = await service.update(USER, 'c1', { color: '#f59e0b', isActive: false });
      expect(updated).toMatchObject({ color: '#f59e0b', isActive: false });
      expect(prisma.customerFlagCategory.update).toHaveBeenCalled();
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'UPDATED' }));
    });

    it('404s for another vendor / unknown category', async () => {
      const { service } = makeService({ categories: [category('c1', 'Payment Overdue', { vendorId: 'other' })] });
      await expect(service.update(USER, 'c1', { color: '#f59e0b' })).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('remove', () => {
    it('removes an unused category and audit-logs it', async () => {
      const { service, prisma, audit } = makeService({ categories: [category('c1', 'Payment Overdue')] });
      await expect(service.remove(USER, 'c1')).resolves.toEqual({ deleted: true });
      expect(prisma.customerFlagCategory.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'DELETED' }));
    });

    it('blocks removal while any flag (active or resolved) uses it', async () => {
      const { service, prisma } = makeService({
        categories: [category('c1', 'Payment Overdue')],
        usage: { c1: 3 },
      });
      await expect(service.remove(USER, 'c1')).rejects.toThrow(/used on 3 flags/);
      expect(prisma.customerFlagCategory.delete).not.toHaveBeenCalled();
    });

    it("404s for another vendor's / unknown category", async () => {
      const { service } = makeService({ categories: [category('c1', 'Payment Overdue', { vendorId: 'other' })] });
      await expect(service.remove(USER, 'c1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
