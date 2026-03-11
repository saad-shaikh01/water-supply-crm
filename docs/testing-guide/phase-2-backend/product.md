# Phase 2 — Backend Unit Tests: Product

**Module path:** `apps/api-backend/src/app/modules/product/`
**Prerequisites:** TST-INF-001, TST-INF-002, TST-INF-003

---

## TST-BE-021: ProductService CRUD unit tests

**Priority:** P1 High
**Type:** Unit Test

### Context
Products are the catalog items that vendors sell (e.g., 19L water bottle). The admin panel manages products globally; the vendor dashboard uses them for pricing. Tests verify CRUD operations enforce `vendorId` isolation.

### File to Create
`apps/api-backend/src/app/modules/product/product.service.spec.ts`

### Tasks

#### Task 1: Read ProductService source
**Action:** Read `apps/api-backend/src/app/modules/product/product.service.ts`
Identify:
- Constructor dependencies
- `findAll(vendorId)`, `create(vendorId, dto)`, `update(id, vendorId, dto)`, `remove(id, vendorId)` signatures
- Whether `remove` does a hard delete or soft delete

#### Task 2: Write CRUD tests
**Action:** Create `apps/api-backend/src/app/modules/product/product.service.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ProductService } from './product.service';
import { PrismaService } from '/* correct path */';
import { prismaMock } from '../../../test/prisma-mock';
import { createMockProduct, mockVendorId } from '../../../test/factories';

describe('ProductService', () => {
  let service: ProductService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ProductService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = module.get<ProductService>(ProductService);
  });

  describe('findAll', () => {
    it('should return all products for the given vendorId', async () => {
      const products = [createMockProduct(), createMockProduct({ id: 'product-002' })];
      prismaMock.product.findMany.mockResolvedValue(products);

      const result = await service.findAll(mockVendorId);

      expect(result).toHaveLength(2);
      expect(prismaMock.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ vendorId: mockVendorId }) }),
      );
    });
  });

  describe('create', () => {
    it('should create a product with the correct vendorId', async () => {
      const newProduct = createMockProduct({ name: 'New Bottle' });
      prismaMock.product.create.mockResolvedValue(newProduct);

      const result = await service.create(mockVendorId, { name: 'New Bottle', basePrice: 160 });

      expect(prismaMock.product.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ vendorId: mockVendorId }),
        }),
      );
    });
  });

  describe('update', () => {
    it('should update product price when product belongs to vendor', async () => {
      prismaMock.product.findFirst.mockResolvedValue(createMockProduct());
      prismaMock.product.update.mockResolvedValue(createMockProduct({ basePrice: 200 }));

      const result = await service.update('product-test-001', mockVendorId, { basePrice: 200 });

      expect(prismaMock.product.update).toHaveBeenCalled();
      expect(result.basePrice).toBe(200);
    });

    it('should throw NotFoundException when product does not belong to vendor', async () => {
      prismaMock.product.findFirst.mockResolvedValue(null);

      await expect(
        service.update('product-test-001', 'wrong-vendor', { basePrice: 200 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should delete product when it belongs to vendor', async () => {
      prismaMock.product.findFirst.mockResolvedValue(createMockProduct());
      prismaMock.product.delete.mockResolvedValue(createMockProduct());

      await service.remove('product-test-001', mockVendorId);

      expect(prismaMock.product.delete).toHaveBeenCalled();
    });

    it('should throw NotFoundException when product does not exist', async () => {
      prismaMock.product.findFirst.mockResolvedValue(null);

      await expect(service.remove('nonexistent', mockVendorId)).rejects.toThrow(NotFoundException);
    });
  });
});
```

### Acceptance Criteria
- [ ] File exists with 6 test cases across `findAll`, `create`, `update`, `remove`
- [ ] All vendorId isolation tests pass
- [ ] All tests pass: `npx nx test api-backend --testFile=src/app/modules/product/product.service.spec.ts`
