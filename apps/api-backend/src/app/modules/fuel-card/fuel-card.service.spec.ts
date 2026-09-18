import type { AuthUser } from '@water-supply-crm/types';
import { FuelCardService } from './fuel-card.service';

/**
 * FuelCardService — accounting-period write guard wiring (Cash Ledger P2).
 * Top-up create and void must call `assertWritable` BEFORE mutating, with the
 * top-up's business date; a rejecting guard must abort the write.
 */
describe('FuelCardService — period guard', () => {
  let service: FuelCardService;
  let prisma: any;
  let audit: any;
  let guard: { assertWritable: jest.Mock };

  const VENDOR_ID = 'vendor-001';
  const CARD_ID = 'card-001';
  const TOPUP_ID = 'topup-001';
  const TOPUP_DATE = new Date('2026-08-10T00:00:00.000Z');

  const USER: AuthUser = {
    userId: 'admin-1',
    email: 'a@example.com',
    name: 'Admin',
    role: 'VENDOR_ADMIN' as AuthUser['role'],
    vendorId: VENDOR_ID,
    customerId: null,
  };

  beforeEach(() => {
    prisma = {
      fuelCard: {
        findFirst: jest.fn().mockResolvedValue({ id: CARD_ID, vendorId: VENDOR_ID, isActive: true, openingBalance: 0 }),
        findUnique: jest.fn().mockResolvedValue({ openingBalance: 0 }),
      },
      fuelCardTopUp: {
        create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: TOPUP_ID, ...data })),
        findFirst: jest.fn().mockResolvedValue({
          id: TOPUP_ID,
          vendorId: VENDOR_ID,
          fuelCardId: CARD_ID,
          status: 'ACTIVE',
          date: TOPUP_DATE,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: TOPUP_ID, status: 'VOIDED' }),
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
      },
      fuelLog: { aggregate: jest.fn().mockResolvedValue({ _sum: { amountPaid: 0 } }) },
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    guard = { assertWritable: jest.fn().mockResolvedValue(undefined) };
    service = new FuelCardService(prisma, audit, guard as any);
  });

  describe('createTopUp', () => {
    const dto = { amount: 1000, date: '2026-08-12T00:00:00.000Z' } as any;

    it('calls the guard once with the dto date, before the insert', async () => {
      await service.createTopUp(USER, CARD_ID, dto);
      expect(guard.assertWritable).toHaveBeenCalledTimes(1);
      expect(guard.assertWritable).toHaveBeenCalledWith(VENDOR_ID, [new Date(dto.date)]);
      expect(guard.assertWritable.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.fuelCardTopUp.create.mock.invocationCallOrder[0],
      );
    });

    it('rejecting guard aborts the insert (nothing persisted, no audit)', async () => {
      guard.assertWritable.mockRejectedValue(new Error('period closed'));
      await expect(service.createTopUp(USER, CARD_ID, dto)).rejects.toThrow('period closed');
      expect(prisma.fuelCardTopUp.create).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });
  });

  describe('voidTopUp', () => {
    const dto = { voidReason: 'entered by mistake' } as any;

    it('calls the guard once with the row date, before the status flip', async () => {
      await service.voidTopUp(USER, TOPUP_ID, dto);
      expect(guard.assertWritable).toHaveBeenCalledTimes(1);
      expect(guard.assertWritable).toHaveBeenCalledWith(VENDOR_ID, [TOPUP_DATE]);
      expect(guard.assertWritable.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.fuelCardTopUp.updateMany.mock.invocationCallOrder[0],
      );
    });

    it('rejecting guard aborts the void (nothing persisted, no audit)', async () => {
      guard.assertWritable.mockRejectedValue(new Error('period closed'));
      await expect(service.voidTopUp(USER, TOPUP_ID, dto)).rejects.toThrow('period closed');
      expect(prisma.fuelCardTopUp.updateMany).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });
  });
});
