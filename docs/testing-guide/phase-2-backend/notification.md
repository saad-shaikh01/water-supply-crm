# Phase 2 — Backend Unit Tests: NotificationService + NotificationPreferenceService

**Test location:** `apps/api-backend/src/app/modules/notifications/`
**Prerequisites:** Phase 1 complete (mock factories + test helpers set up)

---

## Services under test (verified from source)

### NotificationService
**File:** `apps/api-backend/src/app/modules/notifications/notification.service.ts`

- Dependency: `@InjectQueue(QUEUE_NAMES.NOTIFICATIONS) private notificationQueue: Queue`
- Does **not** depend on `PrismaService`
- Three public methods:
  - `queueWhatsApp(phoneNumber, message, idempotencyKey?)` → adds `JOB_NAMES.SEND_WHATSAPP` job
  - `queueSMS(phoneNumber, message, idempotencyKey?)` → adds `JOB_NAMES.SEND_SMS` job
  - `queueFcm(userId, title, body, data?, idempotencyKey?)` → adds `JOB_NAMES.SEND_FCM_NOTIFICATION` job
- When `idempotencyKey` is supplied → job options `{ jobId: idempotencyKey }`; when absent → options arg is `undefined`

### NotificationPreferenceService
**File:** `apps/api-backend/src/app/modules/notifications/notification-preference.service.ts`

- Dependency: `PrismaService`
- Two public methods:
  - `getPreferences(userId)` → `prisma.notificationPreference.findMany({ where: { userId }, orderBy: [{ eventType: 'asc' }, { channel: 'asc' }] })`
  - `upsertPreference(userId, dto)` → `prisma.notificationPreference.upsert(...)` with unique key `userId_eventType_channel`
- `UpsertPreferenceDto` fields (from `dto/upsert-preference.dto.ts`): `eventType: string`, `channel: 'WHATSAPP' | 'SMS' | 'FCM' | 'IN_APP'`, `enabled: boolean`

---

## How to mock BullMQ Queue

```typescript
import { getQueueToken } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '@water-supply-crm/queue';

const mockQueue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };

providers: [
  NotificationService,
  {
    provide: getQueueToken(QUEUE_NAMES.NOTIFICATIONS),
    useValue: mockQueue,
  },
]
```

---

## TST-BE-027: NotificationService queue methods unit tests

**Priority:** P2 Medium
**Type:** Unit Test

### File to Create
`apps/api-backend/src/app/modules/notifications/notification.service.spec.ts`

> **Action:** Read `apps/api-backend/src/app/modules/notifications/notification.service.ts` first.

### Tasks

#### Task 1: Set up the test module

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { NotificationService } from './notification.service';
import { QUEUE_NAMES, JOB_NAMES } from '@water-supply-crm/queue';

describe('NotificationService', () => {
  let service: NotificationService;
  let mockQueue: { add: jest.Mock };

  beforeEach(async () => {
    mockQueue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        {
          provide: getQueueToken(QUEUE_NAMES.NOTIFICATIONS),
          useValue: mockQueue,
        },
      ],
    }).compile();

    service = module.get<NotificationService>(NotificationService);
  });

  afterEach(() => jest.clearAllMocks());
```

#### Task 2: queueWhatsApp tests

```typescript
  describe('queueWhatsApp', () => {
    it('should add a SEND_WHATSAPP job with no options when idempotencyKey is omitted', async () => {
      await service.queueWhatsApp('03001234567', 'Hello world');

      expect(mockQueue.add).toHaveBeenCalledWith(
        JOB_NAMES.SEND_WHATSAPP,
        { phoneNumber: '03001234567', message: 'Hello world' },
        undefined,
      );
    });

    it('should pass idempotencyKey as jobId when provided', async () => {
      await service.queueWhatsApp('03001234567', 'Hello', 'idem-key-001');

      expect(mockQueue.add).toHaveBeenCalledWith(
        JOB_NAMES.SEND_WHATSAPP,
        { phoneNumber: '03001234567', message: 'Hello' },
        { jobId: 'idem-key-001' },
      );
    });
  });
```

#### Task 3: queueSMS tests

```typescript
  describe('queueSMS', () => {
    it('should add a SEND_SMS job with no options when idempotencyKey is omitted', async () => {
      await service.queueSMS('03001234567', 'Your OTP is 1234');

      expect(mockQueue.add).toHaveBeenCalledWith(
        JOB_NAMES.SEND_SMS,
        { phoneNumber: '03001234567', message: 'Your OTP is 1234' },
        undefined,
      );
    });

    it('should pass idempotencyKey as jobId when provided', async () => {
      await service.queueSMS('03001234567', 'OTP', 'sms-idem-001');

      expect(mockQueue.add).toHaveBeenCalledWith(
        JOB_NAMES.SEND_SMS,
        { phoneNumber: '03001234567', message: 'OTP' },
        { jobId: 'sms-idem-001' },
      );
    });
  });
```

#### Task 4: queueFcm tests

```typescript
  describe('queueFcm', () => {
    it('should add a SEND_FCM_NOTIFICATION job with all required fields', async () => {
      await service.queueFcm('user-id-1', 'New Delivery', 'Your order is on the way');

      expect(mockQueue.add).toHaveBeenCalledWith(
        JOB_NAMES.SEND_FCM_NOTIFICATION,
        {
          userId: 'user-id-1',
          title: 'New Delivery',
          body: 'Your order is on the way',
          data: undefined,
        },
        undefined,
      );
    });

    it('should include extra data payload when provided', async () => {
      const extraData = { orderId: 'ord-1', route: 'north' };

      await service.queueFcm('user-id-1', 'Update', 'Body text', extraData);

      expect(mockQueue.add).toHaveBeenCalledWith(
        JOB_NAMES.SEND_FCM_NOTIFICATION,
        { userId: 'user-id-1', title: 'Update', body: 'Body text', data: extraData },
        undefined,
      );
    });

    it('should pass idempotencyKey as jobId when provided', async () => {
      await service.queueFcm('user-id-1', 'T', 'B', undefined, 'fcm-idem-001');

      expect(mockQueue.add).toHaveBeenCalledWith(
        JOB_NAMES.SEND_FCM_NOTIFICATION,
        expect.objectContaining({ userId: 'user-id-1' }),
        { jobId: 'fcm-idem-001' },
      );
    });
  });
});
```

### Acceptance Criteria
- [ ] File exists at `apps/api-backend/src/app/modules/notifications/notification.service.spec.ts`
- [ ] Uses `getQueueToken(QUEUE_NAMES.NOTIFICATIONS)` — **not** `PrismaService`
- [ ] All three methods covered with at least 2 test cases each (with and without `idempotencyKey`)
- [ ] All tests pass: `npx nx test api-backend --testFile=src/app/modules/notifications/notification.service.spec.ts`

---

## TST-BE-027b: NotificationPreferenceService unit tests

**Priority:** P2 Medium
**Type:** Unit Test

### File to Create
`apps/api-backend/src/app/modules/notifications/notification-preference.service.spec.ts`

> **Action:** Read `apps/api-backend/src/app/modules/notifications/notification-preference.service.ts` before writing.
> **Action:** Read `apps/api-backend/src/app/modules/notifications/dto/upsert-preference.dto.ts` to confirm DTO field names.

### Tasks

#### Task 1: Set up the test module

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { PrismaService } from '@water-supply-crm/database';
import { NotificationPreferenceService } from './notification-preference.service';
import { UpsertPreferenceDto } from './dto/upsert-preference.dto';

describe('NotificationPreferenceService', () => {
  let service: NotificationPreferenceService;
  let prisma: DeepMockProxy<PrismaService>;

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationPreferenceService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<NotificationPreferenceService>(NotificationPreferenceService);
  });

  afterEach(() => jest.clearAllMocks());
```

#### Task 2: getPreferences tests

```typescript
  describe('getPreferences', () => {
    it('should query notificationPreference filtered by userId ordered by eventType then channel', async () => {
      prisma.notificationPreference.findMany.mockResolvedValue([]);

      await service.getPreferences('user-1');

      expect(prisma.notificationPreference.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: [{ eventType: 'asc' }, { channel: 'asc' }],
      });
    });

    it('should return the list returned by Prisma', async () => {
      const prefs = [
        { id: 'pref-1', userId: 'user-1', eventType: 'DELIVERY_COMPLETED', channel: 'FCM', enabled: true },
        { id: 'pref-2', userId: 'user-1', eventType: 'DELIVERY_COMPLETED', channel: 'WHATSAPP', enabled: false },
      ];
      prisma.notificationPreference.findMany.mockResolvedValue(prefs as any);

      const result = await service.getPreferences('user-1');

      expect(result).toEqual(prefs);
    });
  });
```

#### Task 3: upsertPreference tests

```typescript
  describe('upsertPreference', () => {
    const dto: UpsertPreferenceDto = {
      eventType: 'DELIVERY_COMPLETED',
      channel: 'WHATSAPP',
      enabled: true,
    };

    it('should call prisma upsert with the composite unique key userId_eventType_channel', async () => {
      prisma.notificationPreference.upsert.mockResolvedValue({} as any);

      await service.upsertPreference('user-1', dto);

      expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith({
        where: {
          userId_eventType_channel: {
            userId: 'user-1',
            eventType: 'DELIVERY_COMPLETED',
            channel: 'WHATSAPP',
          },
        },
        create: {
          userId: 'user-1',
          eventType: 'DELIVERY_COMPLETED',
          channel: 'WHATSAPP',
          enabled: true,
        },
        update: { enabled: true },
      });
    });

    it('should update only the enabled field (not eventType or channel) on conflict', async () => {
      const disableDto: UpsertPreferenceDto = { ...dto, enabled: false };
      prisma.notificationPreference.upsert.mockResolvedValue({} as any);

      await service.upsertPreference('user-1', disableDto);

      // update block must only contain enabled — no other fields
      expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { enabled: false },
        }),
      );
    });

    it('should return the upserted record returned by Prisma', async () => {
      const record = { id: 'pref-1', userId: 'user-1', ...dto };
      prisma.notificationPreference.upsert.mockResolvedValue(record as any);

      const result = await service.upsertPreference('user-1', dto);

      expect(result).toEqual(record);
    });
  });
});
```

### Acceptance Criteria
- [ ] File exists at `apps/api-backend/src/app/modules/notifications/notification-preference.service.spec.ts`
- [ ] Uses `mockDeep<PrismaService>()` — **not** a Queue mock
- [ ] `getPreferences`: asserts exact `where` + `orderBy` shape
- [ ] `upsertPreference`: asserts the composite unique key `userId_eventType_channel` is used
- [ ] `upsertPreference`: asserts `update` block contains **only** `enabled` (no eventType/channel leakage)
- [ ] All tests pass: `npx nx test api-backend --testFile=src/app/modules/notifications/notification-preference.service.spec.ts`
