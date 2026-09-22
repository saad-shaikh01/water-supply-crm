import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '@water-supply-crm/types';
import { ExtraLabourService } from './extra-labour.service';

describe('ExtraLabourService', () => {
  let service: ExtraLabourService;
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
        findFirst: jest.fn(),
      },
      extraLabour: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      expense: {
        aggregate: jest.fn().mockResolvedValue({
          _sum: { amount: 0 },
          _count: { _all: 0 },
          _min: { date: null },
          _max: { date: null },
          _avg: { amount: 0 },
        }),
        groupBy: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    service = new ExtraLabourService(prisma, audit);
  });

  describe('createLabourer', () => {
    it('creates labourer and returns duplicatePhoneWarning if phone exists', async () => {
      prisma.extraLabourType.findFirst.mockResolvedValue({ id: 'type-1', name: 'Loader' });
      prisma.extraLabour.findFirst.mockResolvedValue({ id: 'other-1', phoneNumber: '923001234567' });
      prisma.extraLabour.create.mockResolvedValue({
        id: 'labour-1',
        name: 'Ali',
        phoneNumber: '923001234567',
        labourTypeId: 'type-1',
        labourType: { id: 'type-1', name: 'Loader' },
      });

      const res = await service.createLabourer(USER, {
        name: 'Ali',
        phoneNumber: '03001234567',
        labourTypeId: 'type-1',
      });

      expect(res.duplicatePhoneWarning).toBe(true);
      expect(prisma.extraLabour.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          vendorId: VENDOR_ID,
          name: 'Ali',
          phoneNumber: '923001234567',
          labourTypeId: 'type-1',
        }),
        include: { labourType: { select: { id: true, name: true } } },
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATED',
          entity: 'ExtraLabour',
          entityId: 'labour-1',
        }),
      );
    });

    it('supports phone alias property from frontend payload', async () => {
      prisma.extraLabourType.findFirst.mockResolvedValue({ id: 'type-1', name: 'Loader' });
      prisma.extraLabour.findFirst.mockResolvedValue(null);
      prisma.extraLabour.create.mockResolvedValue({
        id: 'labour-1',
        name: 'Ali',
        phoneNumber: '923001234567',
        labourTypeId: 'type-1',
        labourType: { id: 'type-1', name: 'Loader' },
      });

      await service.createLabourer(USER, {
        name: 'Ali',
        phone: '03001234567',
        labourTypeId: 'type-1',
      });

      expect(prisma.extraLabour.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            phoneNumber: '923001234567',
          }),
        }),
      );
    });

    it('throws NotFoundException if labour type does not exist', async () => {
      prisma.extraLabourType.findFirst.mockResolvedValue(null);

      await expect(
        service.createLabourer(USER, {
          name: 'Ali',
          labourTypeId: 'non-existent',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateLabourer', () => {
    it('updates status to deactivated and logs DEACTIVATED audit event', async () => {
      const existing = { id: 'labour-1', vendorId: VENDOR_ID, isActive: true };
      prisma.extraLabour.findFirst.mockResolvedValue(existing);
      prisma.extraLabour.update.mockResolvedValue({ ...existing, isActive: false });

      const res = await service.updateLabourer(USER, 'labour-1', { isActive: false });

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DEACTIVATED',
          entity: 'ExtraLabour',
          entityId: 'labour-1',
        }),
      );
      expect(res.isActive).toBe(false);
    });
  });

  describe('getSummary', () => {
    it('calculates KPIs correctly', async () => {
      prisma.extraLabour.count
        .mockResolvedValueOnce(10) // active
        .mockResolvedValueOnce(2); // inactive

      prisma.expense.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 5000 } }) // month
        .mockResolvedValueOnce({ _sum: { amount: 25000 } }); // total

      const res = await service.getSummary(VENDOR_ID);

      expect(res).toEqual({
        activeCount: 10,
        inactiveCount: 2,
        paidThisMonth: 5000,
        totalPaid: 25000,
      });
    });
  });
});
