# Phase 2 — Backend Unit Tests: Analytics

**Module path:** `apps/api-backend/src/app/modules/analytics/`
**Prerequisites:** TST-INF-001, TST-INF-002, TST-INF-003

---

## TST-BE-025: AnalyticsService financial report unit tests

**Priority:** P2 Medium
**Type:** Unit Test

### Context
The analytics module aggregates financial, delivery, customer, and staff data for vendor reporting. Financial reports query transaction data grouped by date. Tests verify the date range filter is applied correctly and the aggregation math is correct.

### File to Create
`apps/api-backend/src/app/modules/analytics/analytics.service.spec.ts`

### Tasks

#### Task 1: Read AnalyticsService source
**Action:** Read `apps/api-backend/src/app/modules/analytics/analytics.service.ts`
Identify:
- Constructor dependencies
- `getFinancialReport(vendorId, from, to)` or equivalent method
- What Prisma queries it runs (groupBy, aggregate, or raw)
- The return shape

#### Task 2: Write financial report tests
**Action:** Create `apps/api-backend/src/app/modules/analytics/analytics.service.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService } from './analytics.service';
import { PrismaService } from '/* correct path */';
import { prismaMock } from '../../../test/prisma-mock';
import { mockVendorId } from '../../../test/factories';

const FROM = new Date('2025-01-01');
const TO = new Date('2025-01-31');

describe('AnalyticsService', () => {
  let service: AnalyticsService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = module.get<AnalyticsService>(AnalyticsService);
  });

  describe('getFinancialReport (use actual method name)', () => {
    it('should query transactions with vendorId and date range filters', async () => {
      prismaMock.transaction.findMany.mockResolvedValue([]);

      await service.getFinancialReport(mockVendorId, FROM, TO);

      expect(prismaMock.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            vendorId: mockVendorId,
            createdAt: expect.objectContaining({ gte: FROM, lte: TO }),
          }),
        }),
      );
    });

    it('should return zero totals when no transactions exist in the range', async () => {
      prismaMock.transaction.findMany.mockResolvedValue([]);

      const result = await service.getFinancialReport(mockVendorId, FROM, TO);

      // Assert that totals are 0 (check actual return shape from Task 1)
      expect(result).toBeDefined();
    });
  });
});
```

### Acceptance Criteria
- [ ] File exists with 2 test cases
- [ ] Date range filter is verified in the Prisma query assertion
- [ ] All tests pass: `npx nx test api-backend --testFile=src/app/modules/analytics/analytics.service.spec.ts`

---

## TST-BE-026: AnalyticsService deliveries and customers report unit tests

**Priority:** P2 Medium
**Type:** Unit Test

### File to Create/Modify
`apps/api-backend/src/app/modules/analytics/analytics.service.spec.ts` (add to existing file)

### Tasks

#### Task 1: Read delivery and customer report methods
**Action:** Re-read `apps/api-backend/src/app/modules/analytics/analytics.service.ts`
Find `getDeliveryReport` and `getCustomerReport` (or similar method names).
Note the Prisma models each queries.

#### Task 2: Write delivery report tests
**Action:** Add `describe('getDeliveryReport')`:

```typescript
describe('getDeliveryReport', () => {
  it('should query daily sheets and items within the date range', async () => {
    prismaMock.dailySheet.findMany.mockResolvedValue([]);

    await service.getDeliveryReport(mockVendorId, FROM, TO);

    expect(prismaMock.dailySheet.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ vendorId: mockVendorId }),
      }),
    );
  });
});
```

#### Task 3: Write customer report tests
**Action:** Add `describe('getCustomerReport')`:

```typescript
describe('getCustomerReport', () => {
  it('should return new customer count grouped by period', async () => {
    prismaMock.customer.findMany.mockResolvedValue([]);

    await service.getCustomerReport(mockVendorId, FROM, TO);

    expect(prismaMock.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ vendorId: mockVendorId }),
      }),
    );
  });
});
```

### Acceptance Criteria
- [ ] 2 additional test cases added (1 delivery, 1 customer)
- [ ] All tests pass
