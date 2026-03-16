import { Job } from 'bullmq';
import { DailySheetProcessor } from './daily-sheet.processor';
import {
  createMockCustomer,
  createMockProduct,
  createPrismaMock,
  mockVendorId,
  PrismaMock,
} from '../../../test';

function createJob(data: {
  vendorId: string;
  date: string;
  vanIds?: string[];
}) {
  return {
    id: 'job-1',
    data,
    updateProgress: jest.fn().mockResolvedValue(undefined),
  } as unknown as Job<{
    vendorId: string;
    date: string;
    vanIds?: string[];
  }>;
}

describe('DailySheetProcessor', () => {
  let processor: DailySheetProcessor;
  let prisma: PrismaMock;

  beforeEach(() => {
    prisma = createPrismaMock();
    processor = new DailySheetProcessor(prisma as never);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('process', () => {
    it('returns an empty result when the vendor has no active product', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      const result = await processor.process(
        createJob({ vendorId: mockVendorId, date: '2025-03-10' }),
      );

      expect(prisma.van.findMany).not.toHaveBeenCalled();
      expect(result).toEqual({
        sheetIds: [],
        skippedVans: [],
        insertedOnDemandCount: 0,
        skippedOnDemand: [],
      });
    });

    it('creates a sheet for an eligible van and inserts queued on-demand orders', async () => {
      prisma.product.findFirst.mockResolvedValue(
        createMockProduct({ id: 'product-1', vendorId: mockVendorId }) as never,
      );
      prisma.van.findMany.mockResolvedValue([
        {
          id: 'van-1',
          plateNumber: 'ABC-123',
          defaultDriverId: 'driver-1',
          routes: [{ id: 'route-1' }],
          deliverySchedules: [
            {
              customerId: 'customer-1',
              routeSequence: 1,
              customer: createMockCustomer({
                id: 'customer-1',
                vendorId: mockVendorId,
              }),
            },
          ],
        },
      ] as never);
      prisma.customerOrder.findMany.mockResolvedValue([
        {
          id: 'order-1',
          customerId: 'customer-2',
          productId: 'product-1',
          dispatchVanId: 'van-1',
        },
      ] as never);
      prisma.dailySheet.findFirst.mockResolvedValue(null);
      prisma.dailySheetItem.findMany
        .mockResolvedValueOnce([] as never)
        .mockResolvedValueOnce([] as never);
      prisma.dailySheet.create.mockResolvedValue({ id: 'sheet-1' } as never);
      prisma.customerOrder.updateMany.mockResolvedValue({ count: 1 } as never);

      const job = createJob({ vendorId: mockVendorId, date: '2025-03-10' });
      const result = await processor.process(job);

      expect(prisma.dailySheet.create).toHaveBeenCalledWith({
        data: {
          vendorId: mockVendorId,
          routeId: 'route-1',
          vanId: 'van-1',
          driverId: 'driver-1',
          date: new Date('2025-03-10'),
          items: {
            create: [
              {
                customerId: 'customer-1',
                sequence: 1,
                productId: 'product-1',
                deliveryType: 'SCHEDULED',
              },
              {
                customerId: 'customer-2',
                productId: 'product-1',
                sequence: 2,
                deliveryType: 'ON_DEMAND',
                sourceOrderId: 'order-1',
              },
            ],
          },
        },
      });
      expect(prisma.customerOrder.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['order-1'] } },
        data: {
          dispatchStatus: 'INSERTED_IN_SHEET',
          dispatchedAt: expect.any(Date),
        },
      });
      expect(job.updateProgress).toHaveBeenCalledWith(100);
      expect(result).toEqual({
        sheetIds: ['sheet-1'],
        skippedVans: [],
        insertedOnDemandCount: 1,
        skippedOnDemand: [],
      });
    });

    it('skips vans that have schedules but no default driver assigned', async () => {
      prisma.product.findFirst.mockResolvedValue(
        createMockProduct({ id: 'product-1', vendorId: mockVendorId }) as never,
      );
      prisma.van.findMany.mockResolvedValue([
        {
          id: 'van-2',
          plateNumber: 'XYZ-999',
          defaultDriverId: null,
          routes: [],
          deliverySchedules: [
            {
              customerId: 'customer-1',
              routeSequence: 1,
              customer: createMockCustomer({
                id: 'customer-1',
                vendorId: mockVendorId,
              }),
            },
          ],
        },
      ] as never);
      prisma.customerOrder.findMany.mockResolvedValue([] as never);

      const result = await processor.process(
        createJob({ vendorId: mockVendorId, date: '2025-03-10' }),
      );

      expect(prisma.dailySheet.create).not.toHaveBeenCalled();
      expect(result).toEqual({
        sheetIds: [],
        skippedVans: [
          {
            id: 'van-2',
            plateNumber: 'XYZ-999',
            reason: 'No default driver assigned',
          },
        ],
        insertedOnDemandCount: 0,
        skippedOnDemand: [],
      });
    });
  });
});
