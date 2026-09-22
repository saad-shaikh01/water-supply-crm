import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '@water-supply-crm/types';
import { ExtraLabourTypeService } from './extra-labour-type.service';

describe('ExtraLabourTypeService', () => {
  let service: ExtraLabourTypeService;
  let prisma: any;
  let audit: any;

  const VENDOR_ID = 'vendor-123';
  const USER: AuthUser = {
    userId: 'user-1',
    email: 'test@example.com',
    name: 'Test Admin',
    role: 'VENDOR_ADMIN' as any,
    vendorId: VENDOR_ID,
    customerId: null,
  };

  beforeEach(() => {
    prisma = {
      extraLabourType: {
        count: jest.fn(),
        createMany: jest.fn().mockResolvedValue({ count: 6 }),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      extraLabour: {
        groupBy: jest.fn().mockResolvedValue([]),
        count: jest.fn(),
      },
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    service = new ExtraLabourTypeService(prisma, audit);
  });

  describe('ensureSeeded', () => {
    it('seeds default types if vendor has 0 types', async () => {
      prisma.extraLabourType.count.mockResolvedValue(0);

      await service.ensureSeeded(VENDOR_ID);

      expect(prisma.extraLabourType.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ name: 'Loader', isSystem: false }),
          expect.objectContaining({ name: 'Other', isSystem: true }),
        ]),
        skipDuplicates: true,
      });
    });

    it('skips seeding if vendor already has types', async () => {
      prisma.extraLabourType.count.mockResolvedValue(2);

      await service.ensureSeeded(VENDOR_ID);

      expect(prisma.extraLabourType.createMany).not.toHaveBeenCalled();
    });
  });

  describe('createType', () => {
    it('creates new type and logs audit event', async () => {
      prisma.extraLabourType.count.mockResolvedValue(5);
      prisma.extraLabourType.findFirst.mockResolvedValue(null);
      prisma.extraLabourType.create.mockResolvedValue({
        id: 'type-1',
        vendorId: VENDOR_ID,
        name: 'Electrician',
        isSystem: false,
      });

      const res = await service.createType(USER, { name: '  Electrician  ' });

      expect(prisma.extraLabourType.create).toHaveBeenCalledWith({
        data: {
          vendorId: VENDOR_ID,
          name: 'Electrician',
          isSystem: false,
        },
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATED',
          entity: 'ExtraLabourType',
          entityId: 'type-1',
        }),
      );
      expect(res.name).toBe('Electrician');
    });

    it('rejects duplicate type name (case-insensitive)', async () => {
      prisma.extraLabourType.count.mockResolvedValue(5);
      prisma.extraLabourType.findFirst.mockResolvedValue({ id: 'type-existing', name: 'Loader' });

      await expect(service.createType(USER, { name: 'loader' })).rejects.toThrow(ConflictException);
    });
  });

  describe('deleteType', () => {
    it('rejects deletion of system type', async () => {
      prisma.extraLabourType.findFirst.mockResolvedValue({
        id: 'type-other',
        vendorId: VENDOR_ID,
        name: 'Other',
        isSystem: true,
      });

      await expect(service.deleteType(USER, 'type-other')).rejects.toThrow(BadRequestException);
    });

    it('rejects deletion when type is in use by labourers', async () => {
      prisma.extraLabourType.findFirst.mockResolvedValue({
        id: 'type-loader',
        vendorId: VENDOR_ID,
        name: 'Loader',
        isSystem: false,
      });
      prisma.extraLabour.count.mockResolvedValue(3);

      await expect(service.deleteType(USER, 'type-loader')).rejects.toThrow(ConflictException);
    });

    it('deletes type and logs audit event when unused and non-system', async () => {
      const typeObj = {
        id: 'type-custom',
        vendorId: VENDOR_ID,
        name: 'Custom',
        isSystem: false,
      };
      prisma.extraLabourType.findFirst.mockResolvedValue(typeObj);
      prisma.extraLabour.count.mockResolvedValue(0);
      prisma.extraLabourType.delete.mockResolvedValue(typeObj);

      const res = await service.deleteType(USER, 'type-custom');

      expect(prisma.extraLabourType.delete).toHaveBeenCalledWith({ where: { id: 'type-custom' } });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DELETED',
          entity: 'ExtraLabourType',
          entityId: 'type-custom',
        }),
      );
      expect(res).toEqual({ success: true });
    });
  });
});
