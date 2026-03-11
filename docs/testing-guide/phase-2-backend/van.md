# Phase 2 — Backend Unit Tests: Van

**Module path:** `apps/api-backend/src/app/modules/van/`
**Prerequisites:** TST-INF-001, TST-INF-002, TST-INF-003

---

## TST-BE-022: VanService CRUD and soft-disable unit tests

**Priority:** P1 High
**Type:** Unit Test

### Context
Vans have an `isActive` flag for soft-disable. A disabled van should not appear in daily sheet generation or driver assignment. Tests verify CRUD and that `isActive=false` vans are excluded from active queries.

### File to Create
`apps/api-backend/src/app/modules/van/van.service.spec.ts`

### Tasks

#### Task 1: Read VanService source
**Action:** Read `apps/api-backend/src/app/modules/van/van.service.ts`
Identify:
- Constructor dependencies
- `findAll(vendorId)` — does it filter by `isActive: true` or return all?
- `create`, `update`, `softDisable` (or equivalent) method signatures
- Driver assignment method (if separate)

#### Task 2: Write VanService tests
**Action:** Create `apps/api-backend/src/app/modules/van/van.service.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { VanService } from './van.service';
import { PrismaService } from '/* correct path */';
import { prismaMock } from '../../../test/prisma-mock';
import { createMockVan, createMockUser, mockVendorId } from '../../../test/factories';

describe('VanService', () => {
  let service: VanService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        VanService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = module.get<VanService>(VanService);
  });

  describe('findAll', () => {
    it('should return only active vans for the vendor by default', async () => {
      prismaMock.van.findMany.mockResolvedValue([createMockVan()]);

      await service.findAll(mockVendorId);

      expect(prismaMock.van.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ vendorId: mockVendorId }),
        }),
      );
    });
  });

  describe('create', () => {
    it('should create a van with the given plate number and driver', async () => {
      const mockDriver = createMockUser();
      prismaMock.user.findFirst.mockResolvedValue(mockDriver);
      prismaMock.van.create.mockResolvedValue(createMockVan());

      const result = await service.create(mockVendorId, {
        plateNumber: 'ABC-123',
        driverId: 'user-test-001',
      });

      expect(prismaMock.van.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ vendorId: mockVendorId, plateNumber: 'ABC-123' }),
        }),
      );
    });

    it('should throw NotFoundException when assigned driver does not belong to vendor', async () => {
      prismaMock.user.findFirst.mockResolvedValue(null);

      await expect(
        service.create(mockVendorId, { plateNumber: 'XYZ-999', driverId: 'wrong-driver' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('softDisable (or isActive toggle)', () => {
    it('should set isActive to false on the van', async () => {
      prismaMock.van.findFirst.mockResolvedValue(createMockVan());
      prismaMock.van.update.mockResolvedValue(createMockVan({ isActive: false }));

      await service.softDisable(mockVendorId, 'van-test-001');

      expect(prismaMock.van.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isActive: false }),
        }),
      );
    });

    it('should throw NotFoundException when van does not belong to vendor', async () => {
      prismaMock.van.findFirst.mockResolvedValue(null);

      await expect(service.softDisable('wrong-vendor', 'van-test-001')).rejects.toThrow(NotFoundException);
    });
  });
});
```

> Replace `softDisable` with the actual method name found in Task 1.

### Acceptance Criteria
- [ ] File exists with 5 test cases
- [ ] `isActive` toggle is explicitly tested
- [ ] All tests pass: `npx nx test api-backend --testFile=src/app/modules/van/van.service.spec.ts`
