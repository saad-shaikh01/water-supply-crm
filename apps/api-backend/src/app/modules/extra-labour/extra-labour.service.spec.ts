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
      // Two independent duplicate checks now run (phone + name) — only the
      // phone query should resolve truthy here.
      prisma.extraLabour.findFirst.mockImplementation(({ where }: any) =>
        where.phoneNumber ? Promise.resolve({ id: 'other-1', phoneNumber: '923001234567' }) : Promise.resolve(null),
      );
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

      expect(res.warnings).toEqual(['A labourer with this phone number already exists.']);
      expect(res.data.id).toBe('labour-1');
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

    it('warns (but does not block) on a duplicate active name, with no phone provided', async () => {
      prisma.extraLabourType.findFirst.mockResolvedValue({ id: 'type-1', name: 'Loader' });
      prisma.extraLabour.findFirst.mockImplementation(({ where }: any) =>
        where.name ? Promise.resolve({ id: 'other-1', name: 'Ali' }) : Promise.resolve(null),
      );
      prisma.extraLabour.create.mockResolvedValue({
        id: 'labour-2',
        name: 'Ali',
        phoneNumber: null,
        cnic: null,
        labourTypeId: 'type-1',
        labourType: { id: 'type-1', name: 'Loader' },
      });

      const res = await service.createLabourer(USER, { name: 'Ali', labourTypeId: 'type-1' });

      expect(res.warnings).toEqual(['A labourer named "Ali" already exists.']);
      expect(res.data.id).toBe('labour-2');
      // Not blocked — create() is still called despite the duplicate name.
      expect(prisma.extraLabour.create).toHaveBeenCalled();
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

    it('persists cnic', async () => {
      prisma.extraLabourType.findFirst.mockResolvedValue({ id: 'type-1', name: 'Loader' });
      prisma.extraLabour.findFirst.mockResolvedValue(null);
      prisma.extraLabour.create.mockResolvedValue({
        id: 'labour-3',
        name: 'Ali',
        phoneNumber: null,
        cnic: '35201-1234567-1',
        labourTypeId: 'type-1',
        labourType: { id: 'type-1', name: 'Loader' },
      });

      const res = await service.createLabourer(USER, {
        name: 'Ali',
        labourTypeId: 'type-1',
        cnic: '35201-1234567-1',
      });

      expect(prisma.extraLabour.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ cnic: '35201-1234567-1' }) }),
      );
      expect(res.data.cnic).toBe('35201-1234567-1');
    });
  });

  describe('listLabourers', () => {
    it('filters by labourTypeId and flattens the wire shape', async () => {
      prisma.extraLabour.count.mockResolvedValue(1);
      prisma.extraLabour.findMany.mockResolvedValue([
        {
          id: 'labour-1',
          name: 'Ali',
          phoneNumber: '923001234567',
          cnic: null,
          labourTypeId: 'type-1',
          labourType: { id: 'type-1', name: 'Loader' },
          notes: null,
          isActive: true,
          createdBy: { id: 'user-1', name: 'Test Admin' },
          createdAt: new Date('2026-09-01'),
          updatedAt: new Date('2026-09-01'),
        },
      ]);
      prisma.expense.groupBy.mockResolvedValue([
        { extraLabourId: 'labour-1', _sum: { amount: 5000 }, _count: { _all: 3 }, _max: { date: new Date('2026-09-20') } },
      ]);

      const res = await service.listLabourers(VENDOR_ID, { labourTypeId: 'type-1' } as any);

      expect(prisma.extraLabour.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ labourTypeId: 'type-1' }) }),
      );
      expect(res.data[0]).toEqual(
        expect.objectContaining({
          id: 'labour-1',
          phone: '923001234567',
          labourTypeId: 'type-1',
          labourTypeName: 'Loader',
          totalPaid: 5000,
          paymentsCount: 3,
        }),
      );
    });
  });

  describe('getLabourerProfile', () => {
    it('flattens into {..., summary} with firstPaidAt/largestPayment/avgPayment', async () => {
      prisma.extraLabour.findFirst.mockResolvedValue({
        id: 'labour-1',
        name: 'Ali',
        phoneNumber: '923001234567',
        cnic: null,
        labourTypeId: 'type-1',
        labourType: { id: 'type-1', name: 'Loader' },
        notes: null,
        isActive: true,
        createdAt: new Date('2026-09-01'),
        updatedAt: new Date('2026-09-01'),
      });
      prisma.expense.aggregate
        .mockResolvedValueOnce({
          _sum: { amount: 9000 },
          _count: { _all: 3 },
          _min: { date: new Date('2026-09-05') },
          _max: { date: new Date('2026-09-20'), amount: 4000 },
          _avg: { amount: 3000 },
        })
        .mockResolvedValueOnce({ _sum: { amount: 1500 }, _count: { _all: 1 } });

      const res = await service.getLabourerProfile(VENDOR_ID, 'labour-1');

      expect(res.labourTypeName).toBe('Loader');
      expect(res.summary).toEqual(
        expect.objectContaining({
          totalPaid: 9000,
          paymentsCount: 3,
          firstPaidAt: new Date('2026-09-05'),
          lastPaidAt: new Date('2026-09-20'),
          largestPayment: 4000,
          avgPayment: 3000,
        }),
      );
    });
  });

  describe('getLabourerPayments', () => {
    it('flattens Expense rows into {expenseId, vanPlateNumber, recordedByName}', async () => {
      prisma.extraLabour.findFirst.mockResolvedValue({ id: 'labour-1', vendorId: VENDOR_ID });
      prisma.expense.count.mockResolvedValue(1);
      prisma.expense.aggregate.mockResolvedValue({ _sum: { amount: 2500 } });
      prisma.expense.findMany.mockResolvedValue([
        {
          id: 'exp-1',
          amount: 2500,
          date: new Date('2026-09-10'),
          description: 'Extra labour — Ali',
          paidFromCash: true,
          dailySheetId: null,
          van: { id: 'van-1', plateNumber: 'ABC-123' },
          createdBy: { id: 'user-1', name: 'Test Admin' },
        },
      ]);

      const res = await service.getLabourerPayments(VENDOR_ID, 'labour-1', {} as any);

      expect(res.data[0]).toEqual(
        expect.objectContaining({
          id: 'exp-1',
          expenseId: 'exp-1',
          vanPlateNumber: 'ABC-123',
          recordedByName: 'Test Admin',
        }),
      );
      expect(res.rangeSubtotal).toBe(2500);
    });
  });

  describe('updateLabourer', () => {
    it('updates status to deactivated and logs DEACTIVATED audit event', async () => {
      const existing = {
        id: 'labour-1',
        vendorId: VENDOR_ID,
        isActive: true,
        phoneNumber: null,
        labourTypeId: 'type-1',
      };
      prisma.extraLabour.findFirst.mockResolvedValue(existing);
      prisma.extraLabour.update.mockResolvedValue({
        ...existing,
        isActive: false,
        labourType: { id: 'type-1', name: 'Loader' },
      });

      const res = await service.updateLabourer(USER, 'labour-1', { isActive: false });

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DEACTIVATED',
          entity: 'ExtraLabour',
          entityId: 'labour-1',
        }),
      );
      expect(res.data.isActive).toBe(false);
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
