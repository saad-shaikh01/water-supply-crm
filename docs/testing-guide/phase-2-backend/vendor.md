# Phase 2 — Backend Unit Tests: Vendor & VendorContext

**Module paths:**
- `apps/api-backend/src/app/modules/vendor/`
- `apps/api-backend/src/app/common/interceptors/`
**Prerequisites:** TST-INF-001, TST-INF-002, TST-INF-003

---

## TST-BE-029: VendorService CRUD unit tests (admin)

**Priority:** P1 High
**Type:** Unit Test

### Context
`VendorService` is used by the admin panel (SUPER_ADMIN role) to create, list, and manage vendor accounts. It is the root of the multi-tenant hierarchy — every other resource has a `vendorId`. Tests verify that only SUPER_ADMIN can operate these endpoints (tested via guard) and that vendor creation is idempotent.

### File to Create
`apps/api-backend/src/app/modules/vendor/vendor.service.spec.ts`

### Tasks

#### Task 1: Read VendorService source
**Action:** Read `apps/api-backend/src/app/modules/vendor/vendor.service.ts`
Identify:
- Constructor dependencies
- `findAll()`, `create(dto)`, `update(id, dto)`, `toggleActive(id)` signatures
- Whether `create` also creates an initial SUPER_ADMIN user for the vendor

#### Task 2: Write VendorService tests
**Action:** Create `apps/api-backend/src/app/modules/vendor/vendor.service.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { VendorService } from './vendor.service';
import { PrismaService } from '/* correct path */';
import { prismaMock } from '../../../test/prisma-mock';
import { createMockVendor, mockVendorId } from '../../../test/factories';

describe('VendorService', () => {
  let service: VendorService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        VendorService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = module.get<VendorService>(VendorService);
  });

  describe('findAll', () => {
    it('should return all vendors', async () => {
      prismaMock.vendor.findMany.mockResolvedValue([createMockVendor()]);

      const result = await service.findAll();

      expect(prismaMock.vendor.findMany).toHaveBeenCalled();
      expect(result).toHaveLength(1);
    });
  });

  describe('create', () => {
    it('should create a vendor', async () => {
      prismaMock.vendor.findUnique.mockResolvedValue(null);
      prismaMock.vendor.create.mockResolvedValue(createMockVendor());

      const result = await service.create({ name: 'New Vendor', email: 'new@vendor.com' });

      expect(prismaMock.vendor.create).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should throw ConflictException when vendor email already exists', async () => {
      prismaMock.vendor.findUnique.mockResolvedValue(createMockVendor());

      await expect(
        service.create({ name: 'Dup Vendor', email: 'vendor@test.com' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('toggleActive', () => {
    it('should disable an active vendor', async () => {
      prismaMock.vendor.findUnique.mockResolvedValue(createMockVendor({ isActive: true }));
      prismaMock.vendor.update.mockResolvedValue(createMockVendor({ isActive: false }));

      await service.toggleActive(mockVendorId);

      expect(prismaMock.vendor.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isActive: false }) }),
      );
    });

    it('should re-enable an inactive vendor', async () => {
      prismaMock.vendor.findUnique.mockResolvedValue(createMockVendor({ isActive: false }));
      prismaMock.vendor.update.mockResolvedValue(createMockVendor({ isActive: true }));

      await service.toggleActive(mockVendorId);

      expect(prismaMock.vendor.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isActive: true }) }),
      );
    });
  });
});
```

### Acceptance Criteria
- [ ] File exists with 5 test cases
- [ ] `toggleActive` tests verify both active→inactive and inactive→active transitions
- [ ] All tests pass: `npx nx test api-backend --testFile=src/app/modules/vendor/vendor.service.spec.ts`

---

## TST-BE-030: VendorContextInterceptor unit tests

**Priority:** P0 Critical
**Type:** Unit Test

### Context
`VendorContextInterceptor` is applied globally and extracts `vendorId` from the JWT payload, attaching it to the request. If it fails silently, all downstream services receive `undefined` as `vendorId` which breaks all database queries.

### File to Create
`apps/api-backend/src/app/common/interceptors/vendor-context.interceptor.spec.ts`

### Tasks

#### Task 1: Read interceptor source
**Action:** Read `apps/api-backend/src/app/common/interceptors/vendor-context.interceptor.ts`
Identify:
- How it reads `vendorId` from the request (from JWT user object: `req.user.vendorId`)
- Where it attaches `vendorId` (to `req.vendorId` or `req.user.vendorId`)
- What it does when no user is on the request (unauthenticated routes)

#### Task 2: Write interceptor tests
**Action:** Create `apps/api-backend/src/app/common/interceptors/vendor-context.interceptor.spec.ts`

```typescript
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of } from 'rxjs';
import { VendorContextInterceptor } from './vendor-context.interceptor';

const createMockContext = (user: any): ExecutionContext => ({
  switchToHttp: () => ({
    getRequest: () => ({ user }),
  }),
  getHandler: () => ({}),
  getClass: () => ({}),
} as any);

const mockCallHandler: CallHandler = {
  handle: () => of('next-called'),
};

describe('VendorContextInterceptor', () => {
  let interceptor: VendorContextInterceptor;

  beforeEach(() => {
    interceptor = new VendorContextInterceptor();
  });

  it('should attach vendorId from JWT user to the request', (done) => {
    const user = { id: 'user-001', vendorId: 'vendor-001' };
    const context = createMockContext(user);
    const request = context.switchToHttp().getRequest();

    interceptor.intercept(context, mockCallHandler).subscribe(() => {
      expect(request.vendorId).toBe('vendor-001');
      done();
    });
  });

  it('should call next handler after attaching vendorId', (done) => {
    const user = { id: 'user-001', vendorId: 'vendor-001' };
    const handleSpy = jest.spyOn(mockCallHandler, 'handle');

    interceptor.intercept(createMockContext(user), mockCallHandler).subscribe(() => {
      expect(handleSpy).toHaveBeenCalled();
      done();
    });
  });

  it('should not throw when request has no user (public/unauthenticated route)', (done) => {
    const context = createMockContext(undefined);

    expect(() => {
      interceptor.intercept(context, mockCallHandler).subscribe(() => done());
    }).not.toThrow();
  });
});
```

### Acceptance Criteria
- [ ] File exists with 3 test cases
- [ ] Test verifies `req.vendorId` is set from `req.user.vendorId`
- [ ] All tests pass: `npx nx test api-backend --testFile=src/app/common/interceptors/vendor-context.interceptor.spec.ts`
