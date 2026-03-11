# Phase 2 — Backend Unit Tests: Daily Sheet

**Module path:** `apps/api-backend/src/app/modules/daily-sheet/`
**Prerequisites:** TST-INF-001, TST-INF-002, TST-INF-003

---

## TST-BE-009: DailySheetService.generateForVan() unit tests

**Priority:** P0 Critical
**Type:** Unit Test

### Context
Daily sheet generation is the core operational feature of the platform. The service creates a `DailySheet` for a van and populates `DailySheetItem` rows for each scheduled customer. A bug here silently breaks the entire delivery workflow. Per session 11, generation is per-van (not per-route).

### File to Create
`apps/api-backend/src/app/modules/daily-sheet/daily-sheet.service.spec.ts`

### Tasks

#### Task 1: Read DailySheetService source
**Action:** Read `apps/api-backend/src/app/modules/daily-sheet/daily-sheet.service.ts`
Identify:
- The method that generates sheets (check for `generateForVan`, `generate`, or similar)
- What Prisma models it queries (CustomerDeliverySchedule, Van, DailySheet, DailySheetItem)
- How it determines which customers are on the sheet (by dayOfWeek + vanId)
- Constructor dependencies

#### Task 2: Write generateForVan test suite
**Action:** Create `apps/api-backend/src/app/modules/daily-sheet/daily-sheet.service.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DailySheetService } from './daily-sheet.service';
import { PrismaService } from '/* correct import path */';
import { prismaMock } from '../../../test/prisma-mock';
import { createMockCustomer, createMockVan, createMockVendor, mockVendorId } from '../../../test/factories';

describe('DailySheetService', () => {
  let service: DailySheetService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DailySheetService,
        { provide: PrismaService, useValue: prismaMock },
        // Add other injected services
      ],
    }).compile();

    service = module.get<DailySheetService>(DailySheetService);
  });

  describe('generateForVan (or the actual method name)', () => {
    it('should create a DailySheet and DailySheetItems for all scheduled customers', async () => {
      const mockVan = createMockVan();
      const mockCustomers = [createMockCustomer(), createMockCustomer({ id: 'customer-002' })];
      const mockSheet = { id: 'sheet-001', vanId: 'van-test-001', vendorId: mockVendorId };

      // Mock: van exists
      prismaMock.van.findFirst.mockResolvedValue(mockVan);
      // Mock: no existing sheet for this date+van
      prismaMock.dailySheet.findFirst.mockResolvedValue(null);
      // Mock: scheduled customers for this van on given dayOfWeek
      prismaMock.customerDeliverySchedule.findMany.mockResolvedValue(
        mockCustomers.map((c, i) => ({ customerId: c.id, vanId: 'van-test-001', dayOfWeek: 1, routeSequence: i, customer: c }))
      );
      // Mock: create returns the new sheet
      prismaMock.dailySheet.create.mockResolvedValue(mockSheet as any);

      const result = await service.generateForVan(mockVendorId, { vanId: 'van-test-001', date: '2025-03-10' });

      expect(prismaMock.dailySheet.create).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should throw ConflictException when a sheet already exists for this van and date', async () => {
      const existingSheet = { id: 'existing-sheet', vanId: 'van-test-001' };
      prismaMock.dailySheet.findFirst.mockResolvedValue(existingSheet as any);

      await expect(
        service.generateForVan(mockVendorId, { vanId: 'van-test-001', date: '2025-03-10' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw NotFoundException when van does not belong to vendor', async () => {
      prismaMock.van.findFirst.mockResolvedValue(null);

      await expect(
        service.generateForVan(mockVendorId, { vanId: 'nonexistent-van', date: '2025-03-10' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should create sheet with zero items when no customers are scheduled for the day', async () => {
      prismaMock.van.findFirst.mockResolvedValue(createMockVan());
      prismaMock.dailySheet.findFirst.mockResolvedValue(null);
      prismaMock.customerDeliverySchedule.findMany.mockResolvedValue([]);
      prismaMock.dailySheet.create.mockResolvedValue({ id: 'sheet-empty', vanId: 'van-test-001' } as any);

      const result = await service.generateForVan(mockVendorId, { vanId: 'van-test-001', date: '2025-03-10' });

      expect(result).toBeDefined();
    });
  });
});
```

> The method name `generateForVan` is an assumption. Replace with the actual method name found in Task 1.

### Acceptance Criteria
- [ ] File exists with 4 test cases
- [ ] Tests correctly mock `CustomerDeliverySchedule`, `Van`, and `DailySheet`
- [ ] All tests pass: `npx nx test api-backend --testFile=src/app/modules/daily-sheet/daily-sheet.service.spec.ts`

---

## TST-BE-010: DailySheetService delivery item update unit tests

**Priority:** P0 Critical
**Type:** Unit Test

### Context
Drivers update delivery items during their route — recording filled bottles dropped, empty bottles collected, and failure categories. The `EMPTY_ONLY` category is auto-detected server-side when `filledDropped=0` and status is `COMPLETED`. Incorrect updates corrupt the daily sheet and ledger.

### File to Create/Modify
`apps/api-backend/src/app/modules/daily-sheet/daily-sheet.service.spec.ts` (add to existing file)

### Tasks

#### Task 1: Read update item method
**Action:** Re-read `apps/api-backend/src/app/modules/daily-sheet/daily-sheet.service.ts`
Find the method that updates a `DailySheetItem` (check for `updateItem`, `updateDeliveryItem`, or similar).
Identify:
- The method signature and DTO shape
- The `EMPTY_ONLY` auto-detection logic
- Whether it creates a `Transaction` ledger entry
- What happens when the sheet is already `CLOSED`

#### Task 2: Write update item tests
**Action:** Add `describe('updateDeliveryItem')` (use actual method name) to spec file:

```typescript
describe('updateDeliveryItem (use actual method name)', () => {
  it('should update filledDropped and emptiesCollected on the sheet item', async () => {
    const mockItem = { id: 'item-001', dailySheetId: 'sheet-001', customerId: 'customer-001', status: 'PENDING', filledDropped: 0 };
    const mockSheet = { id: 'sheet-001', status: 'OPEN', vendorId: mockVendorId };
    prismaMock.dailySheetItem.findFirst.mockResolvedValue(mockItem as any);
    prismaMock.dailySheet.findFirst.mockResolvedValue(mockSheet as any);
    prismaMock.dailySheetItem.update.mockResolvedValue({ ...mockItem, filledDropped: 2, status: 'COMPLETED' } as any);

    const result = await service.updateDeliveryItem(mockVendorId, 'item-001', {
      filledDropped: 2, emptiesCollected: 2, status: 'COMPLETED',
    });

    expect(prismaMock.dailySheetItem.update).toHaveBeenCalled();
  });

  it('should auto-set failureCategory to EMPTY_ONLY when filledDropped=0 and status=COMPLETED', async () => {
    const mockItem = { id: 'item-001', dailySheetId: 'sheet-001' };
    const mockSheet = { id: 'sheet-001', status: 'OPEN', vendorId: mockVendorId };
    prismaMock.dailySheetItem.findFirst.mockResolvedValue(mockItem as any);
    prismaMock.dailySheet.findFirst.mockResolvedValue(mockSheet as any);
    prismaMock.dailySheetItem.update.mockResolvedValue(mockItem as any);

    await service.updateDeliveryItem(mockVendorId, 'item-001', {
      filledDropped: 0, emptiesCollected: 2, status: 'COMPLETED',
    });

    expect(prismaMock.dailySheetItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ failureCategory: 'EMPTY_ONLY' }),
      }),
    );
  });

  it('should throw ForbiddenException or error when sheet is CLOSED', async () => {
    const mockItem = { id: 'item-001', dailySheetId: 'sheet-001' };
    const closedSheet = { id: 'sheet-001', status: 'CLOSED', vendorId: mockVendorId };
    prismaMock.dailySheetItem.findFirst.mockResolvedValue(mockItem as any);
    prismaMock.dailySheet.findFirst.mockResolvedValue(closedSheet as any);

    await expect(
      service.updateDeliveryItem(mockVendorId, 'item-001', { filledDropped: 2, status: 'COMPLETED' }),
    ).rejects.toThrow();
  });
});
```

### Acceptance Criteria
- [ ] 3 test cases added for the delivery item update method
- [ ] The `EMPTY_ONLY` auto-detection test specifically checks the Prisma `update` call's data argument
- [ ] All tests pass

---

## TST-BE-011: DailySheetProcessor BullMQ job unit tests

**Priority:** P1 High
**Type:** Unit Test

### Context
`DailySheetProcessor` is a BullMQ processor that generates daily sheets on a schedule. Testing it ensures the job correctly iterates active vans and triggers generation for each.

### File to Create
`apps/api-backend/src/app/modules/daily-sheet/daily-sheet.processor.spec.ts`

### Tasks

#### Task 1: Read processor source
**Action:** Read `apps/api-backend/src/app/modules/daily-sheet/daily-sheet.processor.ts`
Identify:
- The `@Process()` decorated method name
- How it gets the list of active vans to process
- Whether it calls `DailySheetService.generateForVan` directly or through the queue

#### Task 2: Write processor tests
**Action:** Create `apps/api-backend/src/app/modules/daily-sheet/daily-sheet.processor.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { DailySheetProcessor } from './daily-sheet.processor';
import { DailySheetService } from './daily-sheet.service';
import { PrismaService } from '/* correct path */';
import { prismaMock } from '../../../test/prisma-mock';
import { createMockVan, mockVendorId } from '../../../test/factories';

describe('DailySheetProcessor', () => {
  let processor: DailySheetProcessor;
  let sheetService: jest.Mocked<DailySheetService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DailySheetProcessor,
        { provide: PrismaService, useValue: prismaMock },
        {
          provide: DailySheetService,
          useValue: { generateForVan: jest.fn().mockResolvedValue({ id: 'sheet-001' }) },
        },
      ],
    }).compile();

    processor = module.get<DailySheetProcessor>(DailySheetProcessor);
    sheetService = module.get(DailySheetService);
  });

  describe('process (use the actual @Process method name)', () => {
    it('should call generateForVan for each active van', async () => {
      const mockVans = [createMockVan(), createMockVan({ id: 'van-002' })];
      prismaMock.van.findMany.mockResolvedValue(mockVans);

      await processor.process(/* mock job if needed */);

      expect(sheetService.generateForVan).toHaveBeenCalledTimes(2);
    });

    it('should skip vans where sheet already exists (ConflictException should be caught)', async () => {
      const mockVans = [createMockVan()];
      prismaMock.van.findMany.mockResolvedValue(mockVans);
      (sheetService.generateForVan as jest.Mock).mockRejectedValueOnce(new Error('Conflict'));

      // Should NOT throw — processor must catch per-van errors and continue
      await expect(processor.process(/* mock job */)).resolves.not.toThrow();
    });
  });
});
```

### Acceptance Criteria
- [ ] File exists with 2 test cases
- [ ] Processor test verifies `generateForVan` is called for each van
- [ ] ConflictException is swallowed (processor continues to next van)
- [ ] All tests pass
