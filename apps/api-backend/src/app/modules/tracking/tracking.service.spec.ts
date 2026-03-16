import Redis from 'ioredis';
import { TrackingService } from './tracking.service';
import {
  createMockDriverLastLocation,
  createPrismaMock,
  createPrismaProvider,
  createTestModule,
  mockVendorId,
  PrismaMock,
} from '../../../test';

jest.mock('ioredis');

const makeRedisMock = () => ({
  subscribe: jest.fn(),
  on: jest.fn(),
  set: jest.fn().mockResolvedValue('OK'),
  get: jest.fn().mockResolvedValue(null),
  del: jest.fn().mockResolvedValue(1),
  publish: jest.fn().mockResolvedValue(1),
  mget: jest.fn().mockResolvedValue([]),
  scan: jest.fn().mockResolvedValue(['0', []]),
  quit: jest.fn().mockResolvedValue('OK'),
});

describe('TrackingService', () => {
  let service: TrackingService;
  let prisma: PrismaMock;
  let publisherMock: ReturnType<typeof makeRedisMock>;
  let subscriberMock: ReturnType<typeof makeRedisMock>;

  beforeEach(async () => {
    (Redis as unknown as jest.Mock).mockImplementation(makeRedisMock);
    prisma = createPrismaMock();

    const module = await createTestModule({
      providers: [TrackingService, createPrismaProvider(prisma)],
    });

    service = module.get(TrackingService);
    service.onModuleInit();
    publisherMock = (Redis as unknown as jest.Mock).mock.results[0].value;
    subscriberMock = (Redis as unknown as jest.Mock).mock.results[1].value;
  });

  afterEach(async () => {
    await service.onModuleDestroy();
    jest.clearAllMocks();
  });

  describe('onModuleInit', () => {
    it('creates a publisher and subscriber Redis client in order', () => {
      expect(Redis).toHaveBeenCalledTimes(2);
      expect(subscriberMock.subscribe).toHaveBeenCalledWith(
        'tracking:location',
        expect.any(Function),
      );
      expect(subscriberMock.on).toHaveBeenCalledWith(
        'message',
        expect.any(Function),
      );
    });
  });

  describe('updateLocation', () => {
    const dto = {
      latitude: 24.8607,
      longitude: 67.0011,
      speed: 35,
      bearing: 180,
      status: 'DELIVERING',
    };

    beforeEach(() => {
      prisma.driverLastLocation.upsert.mockResolvedValue(
        createMockDriverLastLocation(),
      );
      prisma.dailySheet.findFirst.mockResolvedValue(null);
    });

    it('persists the driver last-known location and writes the live Redis key', async () => {
      await service.updateLocation(
        'driver-1',
        'Ali Khan',
        mockVendorId,
        dto,
        'van-1',
        'sheet-1',
      );

      expect(prisma.driverLastLocation.upsert).toHaveBeenCalledWith({
        where: { driverId: 'driver-1' },
        update: expect.objectContaining({
          vendorId: mockVendorId,
          latitude: 24.8607,
          longitude: 67.0011,
          speed: 35,
          bearing: 180,
          status: 'DELIVERING',
          vanId: 'van-1',
          dailySheetId: 'sheet-1',
          lastSeenAt: expect.any(Date),
        }),
        create: expect.objectContaining({
          driverId: 'driver-1',
          vendorId: mockVendorId,
          latitude: 24.8607,
          longitude: 67.0011,
          speed: 35,
          bearing: 180,
          status: 'DELIVERING',
          vanId: 'van-1',
          dailySheetId: 'sheet-1',
          lastSeenAt: expect.any(Date),
        }),
      });
      expect(publisherMock.set).toHaveBeenCalledWith(
        'tracking:driver:driver-1',
        expect.any(String),
        'EX',
        300,
      );
      expect(publisherMock.publish).toHaveBeenCalledWith(
        'tracking:location',
        expect.stringContaining('"vendorId":"vendor-test-001"'),
      );
    });

    it('derives van and sheet context from the active open daily sheet when missing', async () => {
      prisma.dailySheet.findFirst.mockResolvedValue({
        id: 'sheet-derived',
        vanId: 'van-derived',
      } as never);

      await service.updateLocation('driver-1', 'Ali Khan', mockVendorId, {
        latitude: 24.8607,
        longitude: 67.0011,
      });

      expect(prisma.dailySheet.findFirst).toHaveBeenCalledWith({
        where: {
          driverId: 'driver-1',
          vendorId: mockVendorId,
          isClosed: false,
          date: { gte: expect.any(Date) },
        },
        select: { id: true, vanId: true },
        orderBy: { date: 'desc' },
      });
      expect(prisma.driverLastLocation.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            vanId: 'van-derived',
            dailySheetId: 'sheet-derived',
          }),
        }),
      );
    });

    it('skips daily sheet lookup when explicit context is supplied', async () => {
      await service.updateLocation(
        'driver-1',
        'Ali Khan',
        mockVendorId,
        {
          latitude: 24.8607,
          longitude: 67.0011,
        },
        'van-explicit',
        'sheet-explicit',
      );

      expect(prisma.dailySheet.findFirst).not.toHaveBeenCalled();
      expect(prisma.driverLastLocation.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            vanId: 'van-explicit',
            dailySheetId: 'sheet-explicit',
          }),
        }),
      );
    });
  });

  describe('removeDriver', () => {
    it('removes the live Redis key and publishes an offline event', async () => {
      await service.removeDriver('driver-1', mockVendorId);

      expect(publisherMock.del).toHaveBeenCalledWith(
        'tracking:driver:driver-1',
      );
      expect(publisherMock.publish).toHaveBeenCalledWith(
        'tracking:location',
        expect.stringContaining('"status":"offline"'),
      );
    });
  });

  describe('getDriverLocationFromRedis', () => {
    it('returns null when the Redis key is missing', async () => {
      publisherMock.get.mockResolvedValue(null);

      await expect(service.getDriverLocationFromRedis('driver-1')).resolves.toBeNull();
    });

    it('classifies a recent location as LIVE', async () => {
      publisherMock.get.mockResolvedValue(
        JSON.stringify({
          driverId: 'driver-1',
          driverName: 'Ali Khan',
          vendorId: mockVendorId,
          latitude: 24.8607,
          longitude: 67.0011,
          updatedAt: new Date().toISOString(),
        }),
      );

      const result = await service.getDriverLocationFromRedis('driver-1');

      expect(result).toEqual(
        expect.objectContaining({
          driverId: 'driver-1',
          freshness: 'LIVE',
          lastSeenSeconds: expect.any(Number),
        }),
      );
      expect(result?.lastSeenSeconds).toBeLessThan(60);
    });

    it('classifies a 2 minute old location as STALE', async () => {
      publisherMock.get.mockResolvedValue(
        JSON.stringify({
          driverId: 'driver-1',
          driverName: 'Ali Khan',
          vendorId: mockVendorId,
          latitude: 24.8607,
          longitude: 67.0011,
          updatedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
        }),
      );

      const result = await service.getDriverLocationFromRedis('driver-1');

      expect(result?.freshness).toBe('STALE');
    });

    it('classifies a 6 minute old location as OFFLINE', async () => {
      publisherMock.get.mockResolvedValue(
        JSON.stringify({
          driverId: 'driver-1',
          driverName: 'Ali Khan',
          vendorId: mockVendorId,
          latitude: 24.8607,
          longitude: 67.0011,
          updatedAt: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
        }),
      );

      const result = await service.getDriverLocationFromRedis('driver-1');

      expect(result?.freshness).toBe('OFFLINE');
    });

    it('returns null for corrupted Redis JSON', async () => {
      publisherMock.get.mockResolvedValue('not-json');

      await expect(service.getDriverLocationFromRedis('driver-1')).resolves.toBeNull();
    });
  });

  describe('getDriverLocationFromDb', () => {
    it('queries the persisted last-known record with driver name included', async () => {
      prisma.driverLastLocation.findUnique.mockResolvedValue(null);

      await service.getDriverLocationFromDb('driver-1');

      expect(prisma.driverLastLocation.findUnique).toHaveBeenCalledWith({
        where: { driverId: 'driver-1' },
        include: { driver: { select: { name: true } } },
      });
    });

    it('maps the DB record into the public driver location shape', async () => {
      prisma.driverLastLocation.findUnique.mockResolvedValue({
        ...createMockDriverLastLocation({
          driverId: 'driver-1',
          vendorId: mockVendorId,
          vanId: 'van-1',
          dailySheetId: 'sheet-1',
          lastSeenAt: new Date(),
        }),
        driver: { name: 'Ali Khan' },
      } as never);

      const result = await service.getDriverLocationFromDb('driver-1');

      expect(result).toEqual(
        expect.objectContaining({
          driverId: 'driver-1',
          driverName: 'Ali Khan',
          vendorId: mockVendorId,
          vanId: 'van-1',
          dailySheetId: 'sheet-1',
          freshness: 'LIVE',
        }),
      );
    });
  });

  describe('getDriverLocationResilient', () => {
    it('prefers Redis when a live value exists', async () => {
      publisherMock.get.mockResolvedValue(
        JSON.stringify({
          driverId: 'driver-1',
          driverName: 'Ali Khan',
          vendorId: mockVendorId,
          latitude: 24.8607,
          longitude: 67.0011,
          updatedAt: new Date().toISOString(),
        }),
      );

      const result = await service.getDriverLocationResilient(
        'driver-1',
        mockVendorId,
      );

      expect(result?.driverId).toBe('driver-1');
      expect(prisma.driverLastLocation.findUnique).not.toHaveBeenCalled();
    });

    it('falls back to DB when the Redis key has expired', async () => {
      publisherMock.get.mockResolvedValue(null);
      prisma.driverLastLocation.findUnique.mockResolvedValue({
        ...createMockDriverLastLocation({
          driverId: 'driver-1',
          vendorId: mockVendorId,
          lastSeenAt: new Date(),
        }),
        driver: { name: 'Ali Khan' },
      } as never);

      const result = await service.getDriverLocationResilient(
        'driver-1',
        mockVendorId,
      );

      expect(result).toEqual(
        expect.objectContaining({
          driverId: 'driver-1',
          vendorId: mockVendorId,
        }),
      );
      expect(prisma.driverLastLocation.findUnique).toHaveBeenCalled();
    });

    it('returns null when the DB fallback belongs to another vendor', async () => {
      publisherMock.get.mockResolvedValue(null);
      prisma.driverLastLocation.findUnique.mockResolvedValue({
        ...createMockDriverLastLocation({
          driverId: 'driver-1',
          vendorId: 'vendor-other',
          lastSeenAt: new Date(),
        }),
        driver: { name: 'Ali Khan' },
      } as never);

      await expect(
        service.getDriverLocationResilient('driver-1', mockVendorId),
      ).resolves.toBeNull();
    });
  });

  describe('getActiveDrivers', () => {
    it('returns an empty array when no live Redis keys exist', async () => {
      publisherMock.scan.mockResolvedValue(['0', []]);

      await expect(service.getActiveDrivers(mockVendorId)).resolves.toEqual([]);
    });

    it('filters to the requested vendor and sorts by freshness then driver name', async () => {
      publisherMock.scan
        .mockResolvedValueOnce([
          '1',
          ['tracking:driver:driver-1', 'tracking:driver:driver-2'],
        ])
        .mockResolvedValueOnce(['0', ['tracking:driver:driver-3']]);
      publisherMock.mget.mockResolvedValue([
        JSON.stringify({
          driverId: 'driver-2',
          driverName: 'Zara',
          vendorId: mockVendorId,
          latitude: 24.8607,
          longitude: 67.0011,
          updatedAt: new Date().toISOString(),
        }),
        JSON.stringify({
          driverId: 'driver-x',
          driverName: 'Other Vendor',
          vendorId: 'vendor-other',
          latitude: 24.8607,
          longitude: 67.0011,
          updatedAt: new Date().toISOString(),
        }),
        JSON.stringify({
          driverId: 'driver-1',
          driverName: 'Ali',
          vendorId: mockVendorId,
          latitude: 24.8607,
          longitude: 67.0011,
          updatedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
        }),
      ]);

      const result = await service.getActiveDrivers(mockVendorId);

      expect(result.map((driver) => driver.driverId)).toEqual([
        'driver-2',
        'driver-1',
      ]);
      expect(result.map((driver) => driver.freshness)).toEqual([
        'LIVE',
        'STALE',
      ]);
    });
  });
});
