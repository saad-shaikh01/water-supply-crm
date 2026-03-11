# Phase 2 — Backend Unit Tests: TrackingService

**Test location:** `apps/api-backend/src/app/modules/tracking/`
**Prerequisites:** Phase 1 complete (mock factories + test helpers set up)

---

## Service under test (verified from source)

**File:** `apps/api-backend/src/app/modules/tracking/tracking.service.ts`

Key facts:
- Constructor dependency: `PrismaService` only
- Creates **two** `ioredis` Redis clients in `onModuleInit()`:
  - `this.publisher = new Redis(redisUrl)` — used for SET/GET/SCAN/PUBLISH/DEL
  - `this.subscriber = new Redis(redisUrl)` — subscribes to `tracking:location` channel; must **not** issue regular commands
- Public methods to test:
  - `updateLocation(driverId, driverName, vendorId, dto, vanId?, dailySheetId?)` — upserts `DriverLastLocation` in DB, writes Redis key with TTL, publishes Pub/Sub event
  - `removeDriver(driverId, vendorId)` — deletes Redis key, publishes offline event
  - `getActiveDrivers(vendorId)` — SCAN Redis keys, filter by `vendorId`, add freshness, sort LIVE→STALE→OFFLINE
  - `getDriverLocationFromRedis(driverId)` — GET from Redis, parse, add freshness
  - `getDriverLocationFromDb(driverId)` — `prisma.driverLastLocation.findUnique` with driver name join
  - `getDriverLocationResilient(driverId, vendorId)` — Redis first, DB fallback, enforces `vendorId` isolation
- `freshness` is **derived at read time** from `updatedAt`, never stored:
  - `< 60 s` → `'LIVE'`
  - `60–300 s` → `'STALE'`
  - `> 300 s` → `'OFFLINE'`
- Redis key prefix: `'tracking:driver:'`
- Redis TTL: `300` seconds (5 minutes)
- Pub/Sub channel: `'tracking:location'`

**DriverLocation interface (from source):**
```typescript
interface DriverLocation {
  driverId: string;
  driverName: string;
  vendorId: string;
  vanId?: string;
  dailySheetId?: string;
  latitude: number;
  longitude: number;
  speed?: number;
  bearing?: number;
  status?: string;
  updatedAt: string;        // ISO string
  freshness?: 'LIVE' | 'STALE' | 'OFFLINE';   // derived — not stored
  lastSeenSeconds?: number;                     // derived — not stored
}
```

---

## How to mock Redis clients correctly

`TrackingService.onModuleInit()` calls `new Redis(url)` **twice** in order: publisher first, subscriber second.
With `jest.mock('ioredis', ...)` using a factory that returns a named stub object, recover each instance via
`Redis.mock.results[n].value` (where `n=0` is the publisher, `n=1` is the subscriber). Do **not** use
`Redis.mock.instances[n]` — with factory-based mocks that return a plain object the instance and the returned
value are not the same reference.

```typescript
import Redis from 'ioredis';
jest.mock('ioredis');

// Each new Redis() call returns a fresh stub from this factory
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

(Redis as unknown as jest.Mock).mockImplementation(makeRedisMock);
```

After calling `service.onModuleInit()`:
```typescript
// n=0 → publisher (SET/GET/SCAN/DEL/PUBLISH)
// n=1 → subscriber (subscribe/on only)
const publisherMock = (Redis as unknown as jest.Mock).mock.results[0].value;
const subscriberMock = (Redis as unknown as jest.Mock).mock.results[1].value;
```

---

## TST-BE-028: TrackingService location update and fleet status unit tests

**Priority:** P2 Medium
**Type:** Unit Test

### File to Create
`apps/api-backend/src/app/modules/tracking/tracking.service.spec.ts`

> **Action:** Read `apps/api-backend/src/app/modules/tracking/tracking.service.ts` before writing — confirm constructor, `onModuleInit` order (publisher first, subscriber second), and private constants.
> **Action:** Read `apps/api-backend/src/app/modules/tracking/dto/update-location.dto.ts` to confirm DTO field names.

### Tasks

#### Task 1: Module-level setup

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { PrismaService } from '@water-supply-crm/database';
import Redis from 'ioredis';
import { TrackingService, DriverLocation } from './tracking.service';

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
  let prisma: DeepMockProxy<PrismaService>;
  let publisherMock: ReturnType<typeof makeRedisMock>;

  beforeEach(async () => {
    (Redis as unknown as jest.Mock).mockImplementation(makeRedisMock);
    prisma = mockDeep<PrismaService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrackingService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<TrackingService>(TrackingService);
    await service.onModuleInit();

    // onModuleInit calls new Redis() twice: publisher first (index 0), subscriber second (index 1)
    publisherMock = (Redis as unknown as jest.Mock).mock.results[0].value;
  });

  afterEach(async () => {
    await service.onModuleDestroy();
    jest.clearAllMocks();
  });
```

#### Task 2: updateLocation tests

```typescript
  describe('updateLocation', () => {
    const dto = { latitude: 24.8607, longitude: 67.0011 };

    beforeEach(() => {
      prisma.driverLastLocation.upsert.mockResolvedValue({} as any);
      prisma.dailySheet.findFirst.mockResolvedValue(null);
    });

    it('should upsert DriverLastLocation in the database with correct fields', async () => {
      await service.updateLocation('driver-1', 'Ali Khan', 'vendor-1', dto);

      expect(prisma.driverLastLocation.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { driverId: 'driver-1' },
          update: expect.objectContaining({
            latitude: 24.8607,
            longitude: 67.0011,
            vendorId: 'vendor-1',
          }),
        }),
      );
    });

    it('should set the Redis key with 300-second TTL', async () => {
      await service.updateLocation('driver-1', 'Ali Khan', 'vendor-1', dto);

      expect(publisherMock.set).toHaveBeenCalledWith(
        'tracking:driver:driver-1',
        expect.any(String),
        'EX',
        300,
      );
    });

    it('should publish a location event to the tracking:location channel', async () => {
      await service.updateLocation('driver-1', 'Ali Khan', 'vendor-1', dto);

      expect(publisherMock.publish).toHaveBeenCalledWith(
        'tracking:location',
        expect.stringContaining('"vendorId":"vendor-1"'),
      );
    });

    it('should derive vanId and dailySheetId from the active sheet when not passed', async () => {
      prisma.dailySheet.findFirst.mockResolvedValue({ id: 'sheet-1', vanId: 'van-1' } as any);

      await service.updateLocation('driver-1', 'Ali Khan', 'vendor-1', dto);

      expect(prisma.driverLastLocation.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ vanId: 'van-1', dailySheetId: 'sheet-1' }),
        }),
      );
    });

    it('should use the explicitly passed vanId and dailySheetId without querying Prisma', async () => {
      await service.updateLocation('driver-1', 'Ali Khan', 'vendor-1', dto, 'van-explicit', 'sheet-explicit');

      expect(prisma.dailySheet.findFirst).not.toHaveBeenCalled();
      expect(prisma.driverLastLocation.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ vanId: 'van-explicit', dailySheetId: 'sheet-explicit' }),
        }),
      );
    });
  });
```

#### Task 3: removeDriver tests

```typescript
  describe('removeDriver', () => {
    it('should delete the Redis key for the driver', async () => {
      await service.removeDriver('driver-1', 'vendor-1');

      expect(publisherMock.del).toHaveBeenCalledWith('tracking:driver:driver-1');
    });

    it('should publish an event with status "offline" to the tracking channel', async () => {
      await service.removeDriver('driver-1', 'vendor-1');

      expect(publisherMock.publish).toHaveBeenCalledWith(
        'tracking:location',
        expect.stringContaining('"status":"offline"'),
      );
    });
  });
```

#### Task 4: getDriverLocationFromRedis and freshness tests

```typescript
  describe('getDriverLocationFromRedis', () => {
    it('should return null when the Redis key does not exist', async () => {
      publisherMock.get.mockResolvedValue(null);

      const result = await service.getDriverLocationFromRedis('driver-1');

      expect(result).toBeNull();
    });

    it('should return LIVE freshness for an update less than 60 seconds ago', async () => {
      const loc: Partial<DriverLocation> = {
        driverId: 'driver-1', driverName: 'Ali', vendorId: 'vendor-1',
        latitude: 24.8, longitude: 67.0,
        updatedAt: new Date().toISOString(),
      };
      publisherMock.get.mockResolvedValue(JSON.stringify(loc));

      const result = await service.getDriverLocationFromRedis('driver-1');

      expect(result!.freshness).toBe('LIVE');
      expect(result!.lastSeenSeconds).toBeLessThan(60);
    });

    it('should return STALE freshness for an update 2 minutes ago', async () => {
      const loc: Partial<DriverLocation> = {
        driverId: 'driver-1', driverName: 'Ali', vendorId: 'vendor-1',
        latitude: 24.8, longitude: 67.0,
        updatedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
      };
      publisherMock.get.mockResolvedValue(JSON.stringify(loc));

      const result = await service.getDriverLocationFromRedis('driver-1');

      expect(result!.freshness).toBe('STALE');
    });

    it('should return OFFLINE freshness for an update 6 minutes ago', async () => {
      const loc: Partial<DriverLocation> = {
        driverId: 'driver-1', driverName: 'Ali', vendorId: 'vendor-1',
        latitude: 24.8, longitude: 67.0,
        updatedAt: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
      };
      publisherMock.get.mockResolvedValue(JSON.stringify(loc));

      const result = await service.getDriverLocationFromRedis('driver-1');

      expect(result!.freshness).toBe('OFFLINE');
    });

    it('should return null when the stored JSON is corrupted', async () => {
      publisherMock.get.mockResolvedValue('not-valid-json{{{');

      const result = await service.getDriverLocationFromRedis('driver-1');

      expect(result).toBeNull();
    });
  });
```

#### Task 5: getDriverLocationFromDb tests

```typescript
  describe('getDriverLocationFromDb', () => {
    it('should return null when no DriverLastLocation record exists', async () => {
      prisma.driverLastLocation.findUnique.mockResolvedValue(null);

      const result = await service.getDriverLocationFromDb('driver-1');

      expect(result).toBeNull();
    });

    it('should return a DriverLocation built from the DB record with freshness attached', async () => {
      const now = new Date();
      prisma.driverLastLocation.findUnique.mockResolvedValue({
        driverId: 'driver-1',
        vendorId: 'vendor-1',
        latitude: 24.8,
        longitude: 67.0,
        speed: null,
        bearing: null,
        status: 'ONLINE',
        vanId: 'van-1',
        dailySheetId: 'sheet-1',
        lastSeenAt: now,
        driver: { name: 'Ali Khan' },
      } as any);

      const result = await service.getDriverLocationFromDb('driver-1');

      expect(result).not.toBeNull();
      expect(result!.driverName).toBe('Ali Khan');
      expect(result!.vendorId).toBe('vendor-1');
      expect(result!.freshness).toBeDefined();
    });

    it('should query using findUnique with driver name include', async () => {
      prisma.driverLastLocation.findUnique.mockResolvedValue(null);

      await service.getDriverLocationFromDb('driver-1');

      expect(prisma.driverLastLocation.findUnique).toHaveBeenCalledWith({
        where: { driverId: 'driver-1' },
        include: { driver: { select: { name: true } } },
      });
    });
  });
```

#### Task 6: getDriverLocationResilient tests

```typescript
  describe('getDriverLocationResilient', () => {
    const redisLoc: Partial<DriverLocation> = {
      driverId: 'driver-1', driverName: 'Ali', vendorId: 'vendor-1',
      latitude: 24.8, longitude: 67.0,
      updatedAt: new Date().toISOString(),
    };

    it('should return the Redis value when it exists (DB not queried)', async () => {
      publisherMock.get.mockResolvedValue(JSON.stringify(redisLoc));

      const result = await service.getDriverLocationResilient('driver-1', 'vendor-1');

      expect(result).not.toBeNull();
      expect(result!.driverId).toBe('driver-1');
      expect(prisma.driverLastLocation.findUnique).not.toHaveBeenCalled();
    });

    it('should fall back to DB when Redis key is expired (null)', async () => {
      publisherMock.get.mockResolvedValue(null);
      prisma.driverLastLocation.findUnique.mockResolvedValue({
        driverId: 'driver-1', vendorId: 'vendor-1',
        latitude: 24.8, longitude: 67.0,
        speed: null, bearing: null, status: 'ONLINE',
        vanId: null, dailySheetId: null,
        lastSeenAt: new Date(),
        driver: { name: 'Ali' },
      } as any);

      const result = await service.getDriverLocationResilient('driver-1', 'vendor-1');

      expect(result).not.toBeNull();
      expect(prisma.driverLastLocation.findUnique).toHaveBeenCalled();
    });

    it('should return null when DB record belongs to a different vendor', async () => {
      publisherMock.get.mockResolvedValue(null);
      prisma.driverLastLocation.findUnique.mockResolvedValue({
        driverId: 'driver-1', vendorId: 'vendor-2',  // different vendor
        latitude: 24.8, longitude: 67.0,
        speed: null, bearing: null, status: 'ONLINE',
        vanId: null, dailySheetId: null,
        lastSeenAt: new Date(),
        driver: { name: 'Ali' },
      } as any);

      const result = await service.getDriverLocationResilient('driver-1', 'vendor-1');

      expect(result).toBeNull();
    });

    it('should return null when both Redis and DB have no record', async () => {
      publisherMock.get.mockResolvedValue(null);
      prisma.driverLastLocation.findUnique.mockResolvedValue(null);

      const result = await service.getDriverLocationResilient('driver-1', 'vendor-1');

      expect(result).toBeNull();
    });
  });
```

#### Task 7: getActiveDrivers tests

```typescript
  describe('getActiveDrivers', () => {
    it('should return empty array when no Redis keys exist', async () => {
      publisherMock.scan.mockResolvedValue(['0', []]);

      const result = await service.getActiveDrivers('vendor-1');

      expect(result).toEqual([]);
    });

    it('should filter out drivers belonging to a different vendor', async () => {
      const otherVendorLoc = JSON.stringify({
        driverId: 'driver-2', driverName: 'Bob', vendorId: 'vendor-2',
        latitude: 25.0, longitude: 68.0,
        updatedAt: new Date().toISOString(),
      });
      publisherMock.scan.mockResolvedValue(['0', ['tracking:driver:driver-2']]);
      publisherMock.mget.mockResolvedValue([otherVendorLoc]);

      const result = await service.getActiveDrivers('vendor-1');

      expect(result).toHaveLength(0);
    });

    it('should return drivers belonging to the requested vendor with freshness attached', async () => {
      const myLoc = JSON.stringify({
        driverId: 'driver-1', driverName: 'Ali', vendorId: 'vendor-1',
        latitude: 24.8, longitude: 67.0,
        updatedAt: new Date().toISOString(),
      });
      publisherMock.scan.mockResolvedValue(['0', ['tracking:driver:driver-1']]);
      publisherMock.mget.mockResolvedValue([myLoc]);

      const result = await service.getActiveDrivers('vendor-1');

      expect(result).toHaveLength(1);
      expect(result[0].driverId).toBe('driver-1');
      expect(result[0].freshness).toBeDefined();
    });
  });
});
```

### Acceptance Criteria
- [ ] File exists at `apps/api-backend/src/app/modules/tracking/tracking.service.spec.ts`
- [ ] `ioredis` mocked with `jest.mock('ioredis')` + `mockImplementation(makeRedisMock)`
- [ ] Publisher recovered via `(Redis as jest.Mock).mock.results[0].value` — **not** `mock.instances[0]`
- [ ] All six method groups covered: `updateLocation`, `removeDriver`, `getDriverLocationFromRedis`, `getDriverLocationFromDb`, `getDriverLocationResilient`, `getActiveDrivers`
- [ ] Freshness thresholds tested for all three states: LIVE (<60 s), STALE (60–300 s), OFFLINE (>300 s)
- [ ] `getDriverLocationResilient` tests verify vendorId isolation (cross-vendor → `null`)
- [ ] All tests pass: `npx nx test api-backend --testFile=src/app/modules/tracking/tracking.service.spec.ts`
