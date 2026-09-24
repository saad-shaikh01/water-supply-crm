import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AttendanceCategoryService } from './attendance-category.service';

const VENDOR_ID = 'vendor-1';
const USER = { vendorId: VENDOR_ID, userId: 'user-1', name: 'Admin' } as any;

const category = (id: string, name: string, vendorId = VENDOR_ID) => ({
  id,
  vendorId,
  name,
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
});

function makeService(overrides: { categories?: any[]; usage?: Record<string, number> } = {}) {
  const categories = overrides.categories ?? [];
  const usage = overrides.usage ?? {};

  const prisma: any = {
    attendanceCategory: {
      findMany: jest.fn(async ({ where }: any) => categories.filter((c) => c.vendorId === where.vendorId)),
      findFirst: jest.fn(async ({ where }: any) => {
        if (where.id) return categories.find((c) => c.id === where.id && c.vendorId === where.vendorId) ?? null;
        const wanted = where.name?.equals?.toLowerCase();
        return categories.find((c) => c.vendorId === where.vendorId && c.name.toLowerCase() === wanted) ?? null;
      }),
      create: jest.fn(async ({ data }: any) => ({ id: 'new-id', isActive: true, createdAt: new Date(), ...data })),
      delete: jest.fn(async () => ({})),
    },
    staffAttendance: {
      groupBy: jest.fn(async () =>
        Object.entries(usage).map(([categoryId, n]) => ({ categoryId, _count: { _all: n } })),
      ),
      count: jest.fn(async ({ where }: any) => usage[where.categoryId] ?? 0),
    },
  };
  const audit: any = { log: jest.fn(async () => undefined) };
  return { service: new AttendanceCategoryService(prisma, audit), prisma, audit };
}

describe('AttendanceCategoryService', () => {
  describe('list', () => {
    it('returns this vendor\'s categories with usage counts', async () => {
      const { service } = makeService({
        categories: [category('c1', 'Office — other business'), category('c2', 'Field survey')],
        usage: { c1: 4 },
      });
      const rows = await service.list(VENDOR_ID);
      expect(rows.map((r) => r.name)).toEqual(['Office — other business', 'Field survey']);
      expect(rows.find((r) => r.id === 'c1')?.usageCount).toBe(4);
      expect(rows.find((r) => r.id === 'c2')?.usageCount).toBe(0);
    });
  });

  describe('create', () => {
    it('creates a trimmed, whitespace-collapsed category and audit-logs it', async () => {
      const { service, prisma, audit } = makeService();
      const created = await service.create(USER, { name: '  Office   Business ' });
      expect(prisma.attendanceCategory.create).toHaveBeenCalledWith({
        data: { vendorId: VENDOR_ID, name: 'Office Business' },
      });
      expect(created).toMatchObject({ name: 'Office Business', usageCount: 0 });
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'CREATED', entity: 'AttendanceCategory' }));
    });

    it('rejects a case-insensitive duplicate name', async () => {
      const { service, prisma } = makeService({ categories: [category('c1', 'Field Survey')] });
      await expect(service.create(USER, { name: 'field survey' })).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.attendanceCategory.create).not.toHaveBeenCalled();
    });

    it('rejects a too-short name', async () => {
      const { service } = makeService();
      await expect(service.create(USER, { name: 'A' })).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('remove', () => {
    it('removes an unused category and audit-logs it', async () => {
      const { service, prisma, audit } = makeService({ categories: [category('c1', 'Field Survey')] });
      await expect(service.remove(USER, 'c1')).resolves.toEqual({ deleted: true });
      expect(prisma.attendanceCategory.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'DELETED' }));
    });

    it('blocks removal while any attendance row uses it', async () => {
      const { service, prisma } = makeService({ categories: [category('c1', 'Field Survey')], usage: { c1: 3 } });
      await expect(service.remove(USER, 'c1')).rejects.toThrow(/used on 3 attendance records/);
      expect(prisma.attendanceCategory.delete).not.toHaveBeenCalled();
    });

    it('404s for another vendor\'s / unknown category', async () => {
      const { service } = makeService({ categories: [category('c1', 'Field Survey', 'other-vendor')] });
      await expect(service.remove(USER, 'c1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('assertExists', () => {
    it('resolves for a known active category and 400s for an unknown one', async () => {
      const { service } = makeService({ categories: [category('c1', 'Field Survey')] });
      await expect(service.assertExists(VENDOR_ID, 'c1')).resolves.toBeUndefined();
      await expect(service.assertExists(VENDOR_ID, 'nope')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('uses the given transaction client instead of the default one when provided', async () => {
      const { service } = makeService();
      const tx: any = { attendanceCategory: { findFirst: jest.fn(async () => category('c1', 'Field Survey')) } };
      await service.assertExists(VENDOR_ID, 'c1', tx);
      expect(tx.attendanceCategory.findFirst).toHaveBeenCalled();
    });
  });
});
