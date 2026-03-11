# Phase 3 — Backend Integration Tests: Auth Flow

**Test location:** `apps/api-backend-e2e/src/auth/`
**Prerequisites:** Phase 1 complete, test database configured

---

## Overview

Integration tests use Supertest to make real HTTP calls against a bootstrapped NestJS app connected to a test database. The test database is seeded before each suite and cleared after.

**How to read existing e2e setup:**
Before implementing any ticket in this phase, read:
1. `apps/api-backend-e2e/src/api-backend/api-backend.spec.ts` (existing e2e test)
2. `apps/api-backend-e2e/jest.config.cts`
3. `apps/api-backend-e2e/src/support/global-setup.ts` (if it exists)

This will tell you how the test app is bootstrapped and whether a test DB is already configured.

---

## TST-INT-001: Auth login → JWT → protected route integration test

**Priority:** P0 Critical
**Type:** Integration Test

### Context
Verifies the full auth chain: POST /api/auth/login returns a JWT, the JWT is valid for protected endpoints, and a request without a JWT gets 401.

### File to Create
`apps/api-backend-e2e/src/auth/auth.e2e-spec.ts`

### Tasks

#### Task 1: Read existing e2e bootstrap
**Action:** Read:
- `apps/api-backend-e2e/src/api-backend/api-backend.spec.ts`
- `apps/api-backend-e2e/jest.config.cts`

Note how the NestJS app is started (INestApplication or direct bootstrap), how the test database URL is set, and whether Prisma is seeded in `beforeAll`.

#### Task 2: Create auth integration test file
**Action:** Create `apps/api-backend-e2e/src/auth/auth.e2e-spec.ts`

Follow the same bootstrap pattern as the existing e2e spec. Use the **test database** (not production). The test assumes a user with known credentials exists (seed or create via Prisma in `beforeAll`).

```typescript
import * as request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../../apps/api-backend/src/app/app.module'; // adjust path

// These credentials must match what is seeded in the test database
const TEST_VENDOR_EMAIL = 'testadmin@watercrm.test';
const TEST_VENDOR_PASSWORD = 'TestPassword123!';

describe('Auth Integration', () => {
  let app: INestApplication;
  let accessToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();

    // Seed test user via Prisma directly
    // const prisma = app.get(PrismaService);
    // await prisma.user.create({ data: { email: TEST_VENDOR_EMAIL, password: await bcrypt.hash(TEST_VENDOR_PASSWORD, 10), ... } });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/auth/login', () => {
    it('should return 200 with accessToken for valid credentials', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: TEST_VENDOR_EMAIL, password: TEST_VENDOR_PASSWORD })
        .expect(200);

      expect(response.body).toHaveProperty('accessToken');
      expect(typeof response.body.accessToken).toBe('string');
      accessToken = response.body.accessToken;
    });

    it('should return 401 for invalid password', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: TEST_VENDOR_EMAIL, password: 'wrongpassword' })
        .expect(401);
    });

    it('should return 401 for non-existent user', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'nobody@nowhere.com', password: 'anything' })
        .expect(401);
    });
  });

  describe('GET /api/auth/me (or any protected endpoint)', () => {
    it('should return 200 when Authorization header has valid JWT', async () => {
      await request(app.getHttpServer())
        .get('/api/auth/me') // adjust to actual protected endpoint
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
    });

    it('should return 401 when no Authorization header is provided', async () => {
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .expect(401);
    });

    it('should return 401 when Authorization header has an invalid/expired token', async () => {
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid.jwt.token')
        .expect(401);
    });
  });
});
```

> Adjust the import path for `AppModule` and the protected endpoint path based on what actually exists in the API.

### Acceptance Criteria
- [ ] File exists with 6 test cases
- [ ] Tests run against test database (not production)
- [ ] All tests pass: `npx nx e2e api-backend-e2e --testFile=src/auth/auth.e2e-spec.ts`

---

## TST-INT-002: Auth refresh token rotation integration test

**Priority:** P0 Critical
**Type:** Integration Test

### File to Create/Modify
`apps/api-backend-e2e/src/auth/auth.e2e-spec.ts` (add to existing file)

### Tasks

#### Task 1: Identify refresh token endpoint
**Action:** Read `apps/api-backend/src/app/modules/auth/auth.controller.ts`
Find the refresh token endpoint (likely `POST /api/auth/refresh`). Note:
- Does it read the refresh token from cookie or request body?
- What does it return?

#### Task 2: Write refresh token rotation tests
**Action:** Add to the existing describe block:

```typescript
describe('POST /api/auth/refresh', () => {
  it('should return new accessToken when valid refresh token is provided', async () => {
    // First login to get refresh token (from cookie or body)
    const loginResponse = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: TEST_VENDOR_EMAIL, password: TEST_VENDOR_PASSWORD });

    // Extract refresh token (from Set-Cookie header or body)
    const refreshToken = loginResponse.body.refreshToken
      || loginResponse.headers['set-cookie']?.find((c: string) => c.startsWith('refresh_token='));

    // Use refresh token to get new access token
    const response = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', `refresh_token=${refreshToken}`) // adjust based on actual implementation
      .expect(200);

    expect(response.body).toHaveProperty('accessToken');
  });

  it('should return 401 when refresh token is invalid', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', 'refresh_token=invalid-token')
      .expect(401);
  });

  it('should return 401 when refresh token is used a second time (rotation)', async () => {
    // Login, get refresh token
    const loginResponse = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: TEST_VENDOR_EMAIL, password: TEST_VENDOR_PASSWORD });

    const refreshToken = loginResponse.body.refreshToken;

    // Use once — succeeds
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', `refresh_token=${refreshToken}`)
      .expect(200);

    // Use same token again — should fail (rotation invalidated it)
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', `refresh_token=${refreshToken}`)
      .expect(401);
  });
});
```

### Acceptance Criteria
- [ ] 3 test cases for refresh token
- [ ] Token rotation test verifies the same token cannot be used twice
- [ ] All tests pass

---

## TST-INT-003: Multi-tenant vendorId isolation integration test

**Priority:** P0 Critical
**Type:** Integration Test

### Context
The most critical security property of the platform is that Vendor A cannot see Vendor B's data. Integration tests verify this by creating two vendors, two customers (one per vendor), and confirming neither vendor's token can access the other's customer.

### File to Create
`apps/api-backend-e2e/src/auth/multi-tenant-isolation.e2e-spec.ts`

### Tasks

#### Task 1: Plan test data setup
**Action:** This test needs two vendors with their own users and customers. Plan the `beforeAll`:
1. Create `Vendor A` + `Admin User A` in test DB using Prisma directly
2. Create `Vendor B` + `Admin User B` in test DB using Prisma directly
3. Create `Customer A` under Vendor A
4. Login as Admin A → get `tokenA`
5. Login as Admin B → get `tokenB`

#### Task 2: Write isolation tests
**Action:** Create `apps/api-backend-e2e/src/auth/multi-tenant-isolation.e2e-spec.ts`

```typescript
describe('Multi-Tenant Isolation', () => {
  let tokenA: string;
  let tokenB: string;
  let customerAId: string;

  beforeAll(async () => {
    // Bootstrap app (same as auth.e2e-spec.ts)
    // Create two vendors + users + one customer under Vendor A via Prisma
    // Login both and store tokens
  });

  it('Vendor A token should return Customer A from GET /api/customers', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/customers')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(response.body.data.some((c: any) => c.id === customerAId)).toBe(true);
  });

  it('Vendor B token should NOT return Customer A from GET /api/customers', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/customers')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);

    expect(response.body.data.some((c: any) => c.id === customerAId)).toBe(false);
  });

  it('Vendor B token should return 404 when accessing Customer A directly', async () => {
    await request(app.getHttpServer())
      .get(`/api/customers/${customerAId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);
  });
});
```

### Acceptance Criteria
- [ ] File exists with 3 test cases
- [ ] Test uses two different vendor tokens
- [ ] Cross-vendor access returns 404 or empty array
- [ ] All tests pass
