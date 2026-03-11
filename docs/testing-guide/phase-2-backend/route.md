# Phase 2 — Backend Unit Tests: Route

**Module path:** `apps/api-backend/src/app/modules/route/`
**Prerequisites:** TST-INF-001, TST-INF-002, TST-INF-003

---

## TST-BE-023: RouteService CRUD and van assignment unit tests

**Priority:** P1 High
**Type:** Unit Test

### Context
Routes define geographic delivery areas. Vans are assigned to routes and `DailySheet.routeId` is nullable (a van may cover multiple routes per session 11). Tests verify route CRUD and that assigning a van from a different vendor is rejected.

### File to Create
`apps/api-backend/src/app/modules/route/route.service.spec.ts`

### Tasks

#### Task 1: Read RouteService source
**Action:** Read `apps/api-backend/src/app/modules/route/route.service.ts`
Identify:
- Constructor dependencies
- `findAll(vendorId)`, `create(vendorId, dto)`, `update(id, vendorId, dto)`, `remove(id, vendorId)` signatures
- Any method that assigns vans to routes

#### Task 2: Write RouteService tests
**Action:** Create `apps/api-backend/src/app/modules/route/route.service.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { RouteService } from './route.service';
import { PrismaService } from '/* correct path */';
import { prismaMock } from '../../../test/prisma-mock';
import { createMockRoute, createMockVan, mockVendorId } from '../../../test/factories';

describe('RouteService', () => {
  let service: RouteService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        RouteService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = module.get<RouteService>(RouteService);
  });

  describe('findAll', () => {
    it('should return all routes for the vendor', async () => {
      prismaMock.route.findMany.mockResolvedValue([createMockRoute()]);

      const result = await service.findAll(mockVendorId);

      expect(prismaMock.route.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { vendorId: mockVendorId } }),
      );
    });
  });

  describe('create', () => {
    it('should create a route with the given name and vendorId', async () => {
      prismaMock.route.create.mockResolvedValue(createMockRoute({ name: 'Route North' }));

      const result = await service.create(mockVendorId, { name: 'Route North' });

      expect(prismaMock.route.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ vendorId: mockVendorId, name: 'Route North' }) }),
      );
    });
  });

  describe('update', () => {
    it('should update route name when route belongs to vendor', async () => {
      prismaMock.route.findFirst.mockResolvedValue(createMockRoute());
      prismaMock.route.update.mockResolvedValue(createMockRoute({ name: 'Updated Route' }));

      const result = await service.update('route-test-001', mockVendorId, { name: 'Updated Route' });

      expect(result.name).toBe('Updated Route');
    });

    it('should throw NotFoundException when route does not belong to vendor', async () => {
      prismaMock.route.findFirst.mockResolvedValue(null);

      await expect(
        service.update('route-test-001', 'wrong-vendor', { name: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should delete route when it belongs to vendor', async () => {
      prismaMock.route.findFirst.mockResolvedValue(createMockRoute());
      prismaMock.route.delete.mockResolvedValue(createMockRoute());

      await service.remove('route-test-001', mockVendorId);

      expect(prismaMock.route.delete).toHaveBeenCalled();
    });
  });
});
```

### Acceptance Criteria
- [ ] File exists with 5 test cases
- [ ] All tests pass: `npx nx test api-backend --testFile=src/app/modules/route/route.service.spec.ts`
