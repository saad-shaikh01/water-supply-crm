# Phase 1: Test Infrastructure & Setup

All tickets in this phase MUST be completed before any Phase 2/3/4/5 tickets begin.

---

## TST-INF-001: Install jest-mock-extended and configure Prisma mock

**Phase:** 1 — Infrastructure
**Priority:** P0 Critical
**App:** api-backend

### Context
`jest-mock-extended` provides `mockDeep<T>()` which creates deep type-safe mocks of the `PrismaService`. Without this, writing backend unit tests requires manual mock objects for every Prisma model. This is the foundation all backend unit tests depend on.

### Tasks

#### Task 1: Install jest-mock-extended
**Action:** Run in terminal
```bash
npm install --save-dev jest-mock-extended
```
Verify it appears in root `package.json` under `devDependencies`.

#### Task 2: Create the Prisma mock singleton file
**Action:** Create file at `apps/api-backend/src/test/prisma-mock.ts`

Write the following content exactly:
```typescript
import { PrismaService } from '../../app/modules/../../../libs/shared/database/src';
import { mockDeep, mockReset, DeepMockProxy } from 'jest-mock-extended';

export type PrismaMock = DeepMockProxy<PrismaService>;

export const prismaMock = mockDeep<PrismaService>() as PrismaMock;

beforeEach(() => {
  mockReset(prismaMock);
});
```

> Note: The `PrismaService` import path may need adjustment. Check the actual export path by reading `libs/shared/database/src/index.ts`. Use the correct path.

#### Task 3: Add the prisma mock to Jest setup
**Action:** Modify `apps/api-backend/jest.config.cts`
Add `setupFilesAfterFramework` pointing to the mock file:
```typescript
setupFilesAfterFramework: ['<rootDir>/src/test/prisma-mock.ts'],
```
> Read `apps/api-backend/jest.config.cts` first, then add the property in the correct location.

### Acceptance Criteria
- [ ] `jest-mock-extended` appears in root `package.json` devDependencies
- [ ] File `apps/api-backend/src/test/prisma-mock.ts` exists and compiles without errors
- [ ] Running `npx nx test api-backend` does not throw import errors for the new mock file

---

## TST-INF-002: Create shared NestJS testing module builder

**Phase:** 1 — Infrastructure
**Priority:** P0 Critical
**App:** api-backend

### Context
Every backend unit test needs to bootstrap a `TestingModule` with the service under test and mocked dependencies. A shared helper prevents copy-paste boilerplate across 30+ spec files.

### Tasks

#### Task 1: Create test module builder helper
**Action:** Create file at `apps/api-backend/src/test/create-test-module.ts`

Write the following:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ModuleMetadata } from '@nestjs/common';

/**
 * Creates a NestJS TestingModule with the provided metadata.
 * Use this in beforeEach() for all backend unit tests.
 *
 * Example:
 *   const module = await createTestModule({
 *     providers: [AuthService, { provide: PrismaService, useValue: prismaMock }],
 *   });
 *   service = module.get(AuthService);
 */
export async function createTestModule(metadata: ModuleMetadata): Promise<TestingModule> {
  return Test.createTestingModule(metadata).compile();
}
```

#### Task 2: Create barrel export for test utilities
**Action:** Create file at `apps/api-backend/src/test/index.ts`

Write:
```typescript
export * from './prisma-mock';
export * from './create-test-module';
export * from './factories';
```

### Acceptance Criteria
- [ ] File `apps/api-backend/src/test/create-test-module.ts` exists
- [ ] File `apps/api-backend/src/test/index.ts` exports all test utilities
- [ ] No TypeScript errors in the helper files

---

## TST-INF-003: Create mock data factories for Prisma models

**Phase:** 1 — Infrastructure
**Priority:** P0 Critical
**App:** api-backend

### Context
Unit tests need consistent, reusable mock objects that match Prisma model shapes. Factories provide a single source of truth for test data, preventing tests from breaking when model shapes change.

### Tasks

#### Task 1: Create the factories barrel file
**Action:** Create file at `apps/api-backend/src/test/factories/index.ts`

Write:
```typescript
export * from './vendor.factory';
export * from './user.factory';
export * from './customer.factory';
export * from './product.factory';
export * from './van.factory';
export * from './route.factory';
export * from './daily-sheet.factory';
export * from './transaction.factory';
export * from './payment.factory';
export * from './order.factory';
export * from './ticket.factory';
```

#### Task 2: Create vendor and user factories
**Action:** Create file at `apps/api-backend/src/test/factories/vendor.factory.ts`

First, read `libs/shared/database/prisma/schema.prisma` to get the exact field names for `Vendor` and `User` models. Then write factories matching those exact fields:

```typescript
import { Vendor, User, UserRole } from '@prisma/client';

export const mockVendorId = 'vendor-test-001';
export const mockVendorId2 = 'vendor-test-002';

export function createMockVendor(overrides: Partial<Vendor> = {}): Vendor {
  return {
    id: mockVendorId,
    name: 'Test Water Co.',
    email: 'vendor@test.com',
    phone: '03001234567',
    isActive: true,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  } as Vendor;
}
```

**Action:** Create file at `apps/api-backend/src/test/factories/user.factory.ts`

Read the `User` model fields from the schema, then write:
```typescript
import { User, UserRole } from '@prisma/client';
import { mockVendorId } from './vendor.factory';

export function createMockUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-test-001',
    email: 'driver@test.com',
    password: '$2b$10$hashedpassword',
    name: 'Test Driver',
    role: UserRole.DRIVER,
    vendorId: mockVendorId,
    isActive: true,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  } as User;
}

export function createMockAdminUser(overrides: Partial<User> = {}): User {
  return createMockUser({ id: 'user-admin-001', role: UserRole.SUPER_ADMIN, email: 'admin@test.com', ...overrides });
}
```

#### Task 3: Create customer and product factories
**Action:** Create file at `apps/api-backend/src/test/factories/customer.factory.ts`

Read the `Customer` model from `libs/shared/database/prisma/schema.prisma`. Include all non-optional fields. Write:
```typescript
import { Customer, PaymentType } from '@prisma/client';
import { mockVendorId } from './vendor.factory';

export function createMockCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 'customer-test-001',
    name: 'Test Customer',
    phone: '03009876543',
    address: '123 Test Street',
    bottleCount: 2,
    paymentType: PaymentType.MONTHLY,
    basePrice: 150,
    balance: 0,
    vendorId: mockVendorId,
    isActive: true,
    portalEnabled: false,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  } as Customer;
}
```

**Action:** Create file at `apps/api-backend/src/test/factories/product.factory.ts`

```typescript
import { Product } from '@prisma/client';
import { mockVendorId } from './vendor.factory';

export function createMockProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'product-test-001',
    name: '19L Water Bottle',
    basePrice: 150,
    vendorId: mockVendorId,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  } as Product;
}
```

#### Task 4: Create van, route, and daily-sheet factories
**Action:** Create file at `apps/api-backend/src/test/factories/van.factory.ts`

Read `Van` model from schema, then write:
```typescript
import { Van } from '@prisma/client';
import { mockVendorId } from './vendor.factory';

export function createMockVan(overrides: Partial<Van> = {}): Van {
  return {
    id: 'van-test-001',
    plateNumber: 'ABC-123',
    driverId: 'user-test-001',
    vendorId: mockVendorId,
    isActive: true,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  } as Van;
}
```

**Action:** Create file at `apps/api-backend/src/test/factories/route.factory.ts`

```typescript
import { Route } from '@prisma/client';
import { mockVendorId } from './vendor.factory';

export function createMockRoute(overrides: Partial<Route> = {}): Route {
  return {
    id: 'route-test-001',
    name: 'Route A',
    vendorId: mockVendorId,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  } as Route;
}
```

**Action:** Create file at `apps/api-backend/src/test/factories/daily-sheet.factory.ts`

Read `DailySheet` and `DailySheetItem` models from schema, then write factories for both.

#### Task 5: Create transaction and payment factories
**Action:** Create file at `apps/api-backend/src/test/factories/transaction.factory.ts`

Read `Transaction` model from schema, then write:
```typescript
import { Transaction, TransactionType } from '@prisma/client';
import { mockVendorId } from './vendor.factory';

export function createMockTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'txn-test-001',
    customerId: 'customer-test-001',
    vendorId: mockVendorId,
    type: TransactionType.PAYMENT,
    amount: 300,
    balanceBefore: 300,
    balanceAfter: 0,
    note: null,
    createdAt: new Date('2025-01-01'),
    ...overrides,
  } as Transaction;
}
```

**Action:** Create file at `apps/api-backend/src/test/factories/payment.factory.ts`

Read `PaymentRequest` model from schema, create factory matching all required fields.

#### Task 6: Create order and ticket factories
**Action:** Create files at:
- `apps/api-backend/src/test/factories/order.factory.ts`
- `apps/api-backend/src/test/factories/ticket.factory.ts`

Read `CustomerOrder` and `CustomerTicket` models from schema. Write factories for both following the same pattern as above.

### Acceptance Criteria
- [ ] All 11 factory files exist in `apps/api-backend/src/test/factories/`
- [ ] Each factory function returns an object that satisfies the corresponding Prisma type
- [ ] No TypeScript errors when running `npx nx build api-backend --skip-nx-cache` (type-check)
- [ ] All fields in each factory match the actual Prisma schema fields (verify by reading the schema)

---

## TST-INF-004: Configure Jest coverage thresholds

**Phase:** 1 — Infrastructure
**Priority:** P1 High
**App:** all apps

### Context
Coverage thresholds ensure tests don't regress. Without them, coverage silently drops to 0% after refactors. Configure per-app thresholds that will grow as test suites are built out.

### Tasks

#### Task 1: Add coverage threshold to api-backend Jest config
**Action:** Read `apps/api-backend/jest.config.cts`, then add a `coverageThreshold` block:

Add inside the config object:
```typescript
coverageThreshold: {
  global: {
    statements: 50,
    branches: 40,
    functions: 50,
    lines: 50,
  },
},
collectCoverageFrom: [
  'src/**/*.ts',
  '!src/**/*.spec.ts',
  '!src/**/*.module.ts',
  '!src/main.ts',
  '!src/test/**',
],
```

#### Task 2: Add coverage config to frontend apps
**Action:** For each of the following files, read them first then add the same `collectCoverageFrom` array (adjusted for frontend):
- `apps/vendor-dashboard/jest.config.cts`
- `apps/customer-portal/jest.config.cts`
- `apps/admin-panel/jest.config.cts`

Add to each:
```typescript
collectCoverageFrom: [
  'src/**/*.{ts,tsx}',
  '!src/**/*.spec.{ts,tsx}',
  '!src/**/*.d.ts',
  '!src/app/**/layout.tsx',
  '!src/app/**/page.tsx',
  '!src/app/**/loading.tsx',
],
```

> Do NOT add coverage thresholds to frontend apps yet — component test coverage will be built up in Phase 4.

### Acceptance Criteria
- [ ] `apps/api-backend/jest.config.cts` contains `coverageThreshold` and `collectCoverageFrom`
- [ ] All three frontend `jest.config.cts` files contain `collectCoverageFrom`
- [ ] `npx nx test api-backend --coverage` runs without config errors

---

## TST-INF-005: Add test scripts to root package.json

**Phase:** 1 — Infrastructure
**Priority:** P1 High
**App:** root

### Context
The root `package.json` currently only has a `seed` script. Adding test scripts lets developers and CI pipelines run tests with short, memorable commands.

### Tasks

#### Task 1: Add test scripts
**Action:** Read `package.json` at root, then add the following scripts to the `scripts` object:

```json
"test": "nx run-many -t test --all",
"test:api": "nx test api-backend",
"test:api:watch": "nx test api-backend --watch",
"test:api:cov": "nx test api-backend --coverage",
"test:vendor": "nx test vendor-dashboard",
"test:customer": "nx test customer-portal",
"test:admin": "nx test admin-panel",
"test:cov": "nx run-many -t test --all -- --coverage",
"e2e:vendor": "nx e2e vendor-dashboard-e2e",
"e2e:customer": "nx e2e customer-portal-e2e",
"e2e:admin": "nx e2e admin-panel-e2e"
```

### Acceptance Criteria
- [ ] All 11 scripts appear in root `package.json`
- [ ] `npm run test:api` runs `nx test api-backend` successfully
- [ ] `npm run test` triggers tests across all apps
