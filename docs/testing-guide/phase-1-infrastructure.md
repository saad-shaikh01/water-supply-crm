# Phase 1: Test Infrastructure & Setup

All tickets in this phase MUST be completed before any Phase 2/3/4/5 tickets begin.

---

## TST-INF-001: Install jest-mock-extended and configure Prisma mock

**Phase:** 1 — Infrastructure
**Priority:** P0 Critical
**App:** api-backend

### Context
`jest-mock-extended` provides `mockDeep<T>()` which creates deep type-safe mocks of `PrismaService`. Without this, backend unit tests require manual stub objects for every Prisma model method. All Phase 2 backend unit tests depend on this.

### Tasks

#### Task 1: Install jest-mock-extended
Run in terminal at the repo root:
```bash
npm install --save-dev jest-mock-extended
```
Verify `jest-mock-extended` appears in root `package.json` under `devDependencies`.

#### Task 2: Locate the PrismaService export
**Action:** Read `libs/shared/database/src/index.ts` to find the correct import path for `PrismaService`. The path will be something like `@water-supply-crm/database` or a relative path. Record it — you will use it in all spec files.

#### Task 3: Create the Prisma mock singleton file
**Action:** Create `apps/api-backend/src/test/prisma-mock.ts`

```typescript
import { PrismaService } from '<path-found-in-task-2>';
import { mockDeep, mockReset, DeepMockProxy } from 'jest-mock-extended';

export type PrismaMock = DeepMockProxy<PrismaService>;

export const prismaMock = mockDeep<PrismaService>() as PrismaMock;

beforeEach(() => {
  mockReset(prismaMock);
});
```

#### Task 4: Register mock file in Jest setup
**Action:** Read `apps/api-backend/jest.config.cts`.

The current file is:
```js
module.exports = {
  displayName: 'api-backend',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: { ... },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/apps/api-backend',
};
```

Add `setupFilesAfterEnv` (not `setupFilesAfterFramework`) to the config object:
```js
setupFilesAfterEnv: ['<rootDir>/src/test/prisma-mock.ts'],
```

> `setupFilesAfterEnv` is the correct Jest key. It runs after the test framework is installed in each test file's environment.

### Acceptance Criteria
- [ ] `jest-mock-extended` in root `package.json` devDependencies
- [ ] `apps/api-backend/src/test/prisma-mock.ts` exists and TypeScript compiles
- [ ] `apps/api-backend/jest.config.cts` has `setupFilesAfterEnv` (not `setupFilesAfterFramework`)
- [ ] `npx nx test api-backend` runs without import errors for the mock file

---

## TST-INF-002: Create shared NestJS testing module builder

**Phase:** 1 — Infrastructure
**Priority:** P0 Critical
**App:** api-backend

### Tasks

#### Task 1: Create the helper
**Action:** Create `apps/api-backend/src/test/create-test-module.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ModuleMetadata } from '@nestjs/common';

/**
 * Thin wrapper around Test.createTestingModule().compile().
 * Use in beforeEach() for all backend unit tests.
 *
 * Example:
 *   const module = await createTestModule({
 *     providers: [
 *       AuthService,
 *       { provide: PrismaService, useValue: prismaMock },
 *     ],
 *   });
 *   service = module.get(AuthService);
 */
export async function createTestModule(metadata: ModuleMetadata): Promise<TestingModule> {
  return Test.createTestingModule(metadata).compile();
}
```

#### Task 2: Create barrel export
**Action:** Create `apps/api-backend/src/test/index.ts`

```typescript
export * from './prisma-mock';
export * from './create-test-module';
export * from './factories';
```

### Acceptance Criteria
- [ ] Both files exist
- [ ] No TypeScript errors

---

## TST-INF-003: Create mock data factories for Prisma models

**Phase:** 1 — Infrastructure
**Priority:** P0 Critical
**App:** api-backend

### Context
All factories must be derived from the actual Prisma schema at `libs/shared/database/prisma/schema.prisma`. The schema was read and the correct field names are used below. Do not invent fields.

**Key schema facts:**
- `Vendor`: `id`, `name`, `slug`, `address?`, `logoUrl?`, `raastId?`, `isActive`, `createdAt`, `updatedAt` — **no `email`, no `phone`**
- `User`: `id`, `email`, `password`, `name`, `phoneNumber?`, `role`, `isActive`, `vendorId?`, `createdAt`, `updatedAt`
- `Customer`: `id`, `customerCode`, `name`, `phoneNumber`, `address`, `vendorId`, `paymentType`, `isActive`, `financialBalance`, `createdAt`, `updatedAt` — **no `bottleCount`, no `balance`, no `portalEnabled`**
- `Van`: `id`, `plateNumber`, `vendorId`, `isActive`, `defaultDriverId?`, `createdAt`, `updatedAt` — **field is `defaultDriverId`, not `driverId`**
- `DailySheet`: `id`, `date`, `vendorId`, `vanId`, `driverId`, `isClosed`, `routeId?`, `filledOutCount`, `filledInCount`, `emptyInCount`, `cashExpected`, `cashCollected`, `createdAt`, `updatedAt` — **field is `isClosed: boolean`, not `status: string`**
- `Transaction`: `id`, `type`, `vendorId`, `customerId?`, `productId?`, `amount?`, `description?`, `createdAt`
- `PaymentRequest`: `id`, `vendorId`, `customerId`, `amount`, `method`, `status`, `gatewayOrderId?`, `checkoutUrl?`, `referenceNo?`, `screenshotPath?`, `createdAt`, `updatedAt`
- `CustomerOrder`: `id`, `vendorId`, `customerId`, `productId`, `quantity`, `status` (OrderStatus enum: PENDING/APPROVED/REJECTED/CANCELLED), `createdAt`, `updatedAt`
- `CustomerTicket`: `id`, `vendorId`, `customerId`, `type` (TicketType), `subject`, `description`, `status` (TicketStatus), `priority` (TicketPriority), `createdAt`, `updatedAt`

### Tasks

#### Task 1: Create factories barrel file
**Action:** Create `apps/api-backend/src/test/factories/index.ts`

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

#### Task 2: Vendor and User factories
**Action:** Create `apps/api-backend/src/test/factories/vendor.factory.ts`

```typescript
import { Vendor } from '@prisma/client';

export const mockVendorId = 'vendor-test-001';

export function createMockVendor(overrides: Partial<Vendor> = {}): Vendor {
  return {
    id: mockVendorId,
    name: 'Test Water Co.',
    slug: 'test-water-co',
    address: null,
    logoUrl: null,
    raastId: null,
    isActive: true,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  } as Vendor;
}
```

**Action:** Create `apps/api-backend/src/test/factories/user.factory.ts`

```typescript
import { User, UserRole } from '@prisma/client';
import { mockVendorId } from './vendor.factory';

export function createMockUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-test-001',
    email: 'driver@test.com',
    password: '$2b$10$hashedpassword',
    name: 'Test Driver',
    phoneNumber: null,
    role: UserRole.DRIVER,
    vendorId: mockVendorId,
    isActive: true,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  } as User;
}

export function createMockVendorAdmin(overrides: Partial<User> = {}): User {
  return createMockUser({
    id: 'user-admin-001',
    role: UserRole.VENDOR_ADMIN,
    email: 'admin@test.com',
    ...overrides,
  });
}
```

#### Task 3: Customer and Product factories
**Action:** Create `apps/api-backend/src/test/factories/customer.factory.ts`

```typescript
import { Customer, PaymentType } from '@prisma/client';
import { mockVendorId } from './vendor.factory';

export function createMockCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 'customer-test-001',
    customerCode: 'CUST-001',
    name: 'Test Customer',
    phoneNumber: '03009876543',
    address: '123 Test Street, Karachi',
    floor: null,
    nearbyLandmark: null,
    deliveryInstructions: null,
    googleMapsUrl: null,
    latitude: null,
    longitude: null,
    vendorId: mockVendorId,
    routeId: null,
    userId: null,
    paymentType: PaymentType.CASH,
    isActive: true,
    financialBalance: 0,         // correct field name — not 'balance'
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  } as Customer;
}
```

**Action:** Create `apps/api-backend/src/test/factories/product.factory.ts`

```typescript
import { Product } from '@prisma/client';
import { mockVendorId } from './vendor.factory';

export function createMockProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'product-test-001',
    name: '19L Water Bottle',
    description: null,
    basePrice: 150,
    vendorId: mockVendorId,
    isActive: true,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  } as Product;
}
```

#### Task 4: Van and Route factories
**Action:** Create `apps/api-backend/src/test/factories/van.factory.ts`

```typescript
import { Van } from '@prisma/client';
import { mockVendorId } from './vendor.factory';

export function createMockVan(overrides: Partial<Van> = {}): Van {
  return {
    id: 'van-test-001',
    plateNumber: 'ABC-123',
    vendorId: mockVendorId,
    isActive: true,
    defaultDriverId: 'user-test-001',  // correct field — not 'driverId'
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  } as Van;
}
```

**Action:** Create `apps/api-backend/src/test/factories/route.factory.ts`

```typescript
import { Route } from '@prisma/client';
import { mockVendorId } from './vendor.factory';

export function createMockRoute(overrides: Partial<Route> = {}): Route {
  return {
    id: 'route-test-001',
    name: 'Route North',
    vendorId: mockVendorId,
    defaultVanId: null,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  } as Route;
}
```

#### Task 5: DailySheet factory
**Action:** Create `apps/api-backend/src/test/factories/daily-sheet.factory.ts`

```typescript
import { DailySheet } from '@prisma/client';
import { mockVendorId } from './vendor.factory';

export function createMockDailySheet(overrides: Partial<DailySheet> = {}): DailySheet {
  return {
    id: 'sheet-test-001',
    date: new Date('2025-03-10'),
    vendorId: mockVendorId,
    vanId: 'van-test-001',
    driverId: 'user-test-001',
    routeId: null,
    isClosed: false,              // correct field — not 'status'
    filledOutCount: 0,
    filledInCount: 0,
    emptyInCount: 0,
    cashExpected: 0,
    cashCollected: 0,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  } as DailySheet;
}
```

#### Task 6: Transaction and Payment factories
**Action:** Create `apps/api-backend/src/test/factories/transaction.factory.ts`

```typescript
import { Transaction, TransactionType } from '@prisma/client';
import { mockVendorId } from './vendor.factory';

export function createMockTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'txn-test-001',
    type: TransactionType.PAYMENT,
    vendorId: mockVendorId,
    customerId: 'customer-test-001',
    productId: null,
    dailySheetId: null,
    dailySheetItemId: null,
    bottleCount: null,
    filledDropped: null,
    emptyReceived: null,
    amount: 300,
    description: null,
    createdAt: new Date('2025-01-01'),
    ...overrides,
  } as Transaction;
}
```

**Action:** Create `apps/api-backend/src/test/factories/payment.factory.ts`

```typescript
import { PaymentRequest, PaymentMethod, PaymentRequestStatus } from '@prisma/client';
import { mockVendorId } from './vendor.factory';

export function createMockPaymentRequest(overrides: Partial<PaymentRequest> = {}): PaymentRequest {
  return {
    id: 'pr-test-001',
    vendorId: mockVendorId,
    customerId: 'customer-test-001',
    amount: 500,
    method: PaymentMethod.MANUAL_RAAST,
    status: PaymentRequestStatus.PENDING,
    gatewayOrderId: null,
    gatewayTxId: null,
    checkoutUrl: null,
    qrCodeData: null,
    qrExpiresAt: null,
    referenceNo: 'REF123',
    screenshotPath: null,
    customerNote: null,
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: null,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  } as PaymentRequest;
}
```

#### Task 7: Order and Ticket factories
**Action:** Create `apps/api-backend/src/test/factories/order.factory.ts`

```typescript
import { CustomerOrder, OrderStatus, DispatchStatus } from '@prisma/client';
import { mockVendorId } from './vendor.factory';

export function createMockOrder(overrides: Partial<CustomerOrder> = {}): CustomerOrder {
  return {
    id: 'order-test-001',
    vendorId: mockVendorId,
    customerId: 'customer-test-001',
    productId: 'product-test-001',
    quantity: 2,
    status: OrderStatus.PENDING,
    note: null,
    preferredDate: null,
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: null,
    dispatchStatus: DispatchStatus.UNPLANNED,
    targetDate: null,
    timeWindow: null,
    dispatchVanId: null,
    dispatchDriverId: null,
    dispatchMode: null,
    dispatchNotes: null,
    plannedAt: null,
    plannedById: null,
    dispatchedAt: null,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  } as CustomerOrder;
}
```

**Action:** Create `apps/api-backend/src/test/factories/ticket.factory.ts`

```typescript
import { CustomerTicket, TicketType, TicketStatus, TicketPriority } from '@prisma/client';
import { mockVendorId } from './vendor.factory';

export function createMockTicket(overrides: Partial<CustomerTicket> = {}): CustomerTicket {
  return {
    id: 'ticket-test-001',
    vendorId: mockVendorId,
    customerId: 'customer-test-001',
    type: TicketType.COMPLAINT,
    subject: 'Test complaint',
    description: 'Something went wrong',
    status: TicketStatus.OPEN,
    priority: TicketPriority.NORMAL,
    vendorReply: null,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  } as CustomerTicket;
}
```

### Acceptance Criteria
- [ ] All 11 factory files exist in `apps/api-backend/src/test/factories/`
- [ ] Every field in every factory matches the actual Prisma model field names (verified against the schema above)
- [ ] No fields from old schema versions appear: no `balance`, `bottleCount`, `portalEnabled`, `driverId` (on Van), `status` (on DailySheet), `email`/`phone` (on Vendor)
- [ ] Running `npx nx test api-backend` compiles factory imports without TypeScript errors

---

## TST-INF-004: Configure Jest coverage collection

**Phase:** 1 — Infrastructure
**Priority:** P1 High
**App:** all apps

### Tasks

#### Task 1: Add coverage config to api-backend Jest config
**Action:** Read `apps/api-backend/jest.config.cts`, then add `collectCoverageFrom`:

```js
collectCoverageFrom: [
  'src/**/*.ts',
  '!src/**/*.spec.ts',
  '!src/**/*.module.ts',
  '!src/main.ts',
  '!src/test/**',
],
coverageThreshold: {
  global: {
    statements: 40,
    branches: 30,
    functions: 40,
    lines: 40,
  },
},
```

> Start thresholds low (40%). They will be raised incrementally as tests are added.

#### Task 2: Add coverage config to frontend Jest configs
**Action:** For each file, read it first, then add `collectCoverageFrom`:
- `apps/vendor-dashboard/jest.config.cts`
- `apps/customer-portal/jest.config.cts`
- `apps/admin-panel/jest.config.cts`

Add to each:
```js
collectCoverageFrom: [
  'src/**/*.{ts,tsx}',
  '!src/**/*.spec.{ts,tsx}',
  '!src/**/*.d.ts',
  '!src/app/**/layout.tsx',
  '!src/app/**/page.tsx',
  '!src/app/**/loading.tsx',
],
```

> Do NOT add `coverageThreshold` to frontend configs yet.

### Acceptance Criteria
- [ ] `apps/api-backend/jest.config.cts` has `collectCoverageFrom` and `coverageThreshold`
- [ ] All three frontend `jest.config.cts` files have `collectCoverageFrom`
- [ ] `npx nx test api-backend --coverage` completes without config errors

---

## TST-INF-005: Add test scripts to root package.json

**Phase:** 1 — Infrastructure
**Priority:** P1 High

### Tasks

**Action:** Read root `package.json`, then add to the `scripts` object:

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
"e2e:admin": "nx e2e admin-panel-e2e",
"e2e:api": "nx e2e api-backend-e2e"
```

### Acceptance Criteria
- [ ] All 12 scripts appear in root `package.json`
- [ ] `npm run test:api` successfully invokes `nx test api-backend`
