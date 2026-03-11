# Phase 3 — Backend Integration Tests: Auth Flow

**Test location:** `apps/api-backend-e2e/src/auth/`
**Prerequisites:** Phase 1 complete

---

## How the api-backend-e2e harness works

**Read these files before writing any test in this phase:**
1. `apps/api-backend-e2e/src/support/global-setup.ts` — waits for `HOST:PORT` to be open with `waitForPortOpen`
2. `apps/api-backend-e2e/src/support/test-setup.ts` — configures `axios.defaults.baseURL = http://HOST:PORT`
3. `apps/api-backend-e2e/src/api-backend/api-backend.spec.ts` — existing example: imports `axios`, calls `axios.get('/api')`
4. `apps/api-backend-e2e/jest.config.cts` — uses `globalSetup`, `globalTeardown`, `setupFiles`

**The harness runs against an already-running server** — it does NOT bootstrap NestJS inside the test process. There is no `@nestjs/testing` or Supertest in-process bootstrap. Tests call `axios` (pre-configured with base URL), or can use Supertest's `supertest.agent(axios.defaults.baseURL)`.

**Correct test pattern:**
```typescript
import axios from 'axios';

describe('POST /api/auth/login', () => {
  it('should return 200 for valid credentials', async () => {
    const res = await axios.post('/api/auth/login', { identifier: '...', password: '...' });
    expect(res.status).toBe(200);
  });
});
```

**NOT this** (wrong — NestJS bootstrap not used in this harness):
```typescript
// ❌ WRONG — do not use @nestjs/testing in api-backend-e2e
import { Test } from '@nestjs/testing';
const app = moduleFixture.createNestApplication();
```

---

## API contract (verified from source)

| Field | Value |
|-------|-------|
| Login request body | `{ identifier: string, password: string }` — **identifier, not email** |
| Login response | `{ access_token, refresh_token, expires_in, user: { id, email, name, role, vendorId } }` |
| Refresh request body | `{ refreshToken: string }` — **body DTO, not cookie** |
| Refresh response | Same as login response |
| Protected endpoint | `GET /api/auth/me` with `Authorization: Bearer <access_token>` |

---

## TST-INT-001: Auth login → JWT → protected route integration test

**Priority:** P0 Critical
**Type:** Integration Test

### File to Create
`apps/api-backend-e2e/src/auth/auth.e2e-spec.ts`

### Tasks

#### Task 1: Seed test credentials
Before running integration tests, a test user must exist in the database. Two options:
- Option A: Use the existing seed script (`npm run seed`) with known test credentials
- Option B: Create a test user directly via Prisma in a `beforeAll` using `PrismaClient`

Determine which approach is used by reading `apps/api-backend-e2e/src/support/global-setup.ts` and any existing seed/fixture files.

Use environment variables for credentials:
```
HOST=localhost PORT=3000 TEST_IDENTIFIER=admin@test.com TEST_PASSWORD=TestPassword123!
```

#### Task 2: Write the test file
**Action:** Create `apps/api-backend-e2e/src/auth/auth.e2e-spec.ts`

```typescript
import axios from 'axios';

const TEST_IDENTIFIER = process.env.TEST_IDENTIFIER ?? 'admin@test.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? 'TestPassword123!';

describe('Auth API', () => {
  let accessToken: string;

  // ─── POST /api/auth/login ─────────────────────────────────────────────────

  describe('POST /api/auth/login', () => {
    it('should return 200 with access_token and refresh_token for valid credentials', async () => {
      const res = await axios.post('/api/auth/login', {
        identifier: TEST_IDENTIFIER,
        password: TEST_PASSWORD,
      });

      expect(res.status).toBe(200);
      expect(res.data).toHaveProperty('access_token');
      expect(res.data).toHaveProperty('refresh_token');
      expect(res.data).toHaveProperty('user');
      expect(typeof res.data.access_token).toBe('string');
      accessToken = res.data.access_token;
    });

    it('should return 401 for wrong password', async () => {
      await expect(
        axios.post('/api/auth/login', { identifier: TEST_IDENTIFIER, password: 'wrongpass' }),
      ).rejects.toMatchObject({ response: { status: 401 } });
    });

    it('should return 401 for non-existent identifier', async () => {
      await expect(
        axios.post('/api/auth/login', { identifier: 'nobody@nowhere.com', password: 'anything' }),
      ).rejects.toMatchObject({ response: { status: 401 } });
    });
  });

  // ─── GET /api/auth/me ─────────────────────────────────────────────────────

  describe('GET /api/auth/me', () => {
    it('should return 200 with user profile when Authorization header is valid', async () => {
      const res = await axios.get('/api/auth/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      expect(res.status).toBe(200);
      expect(res.data).toHaveProperty('email');
      expect(res.data).not.toHaveProperty('password');
    });

    it('should return 401 when no Authorization header is sent', async () => {
      await expect(
        axios.get('/api/auth/me'),
      ).rejects.toMatchObject({ response: { status: 401 } });
    });

    it('should return 401 when Authorization header has a malformed token', async () => {
      await expect(
        axios.get('/api/auth/me', { headers: { Authorization: 'Bearer not.a.real.token' } }),
      ).rejects.toMatchObject({ response: { status: 401 } });
    });
  });
});
```

### Acceptance Criteria
- [ ] File exists using `axios` (no `@nestjs/testing`, no Supertest bootstrap)
- [ ] Request body uses `identifier` — not `email`
- [ ] Response assertions check `access_token` — not `accessToken`
- [ ] All tests pass: `npx nx e2e api-backend-e2e --testFile=src/auth/auth.e2e-spec.ts`

---

## TST-INT-002: Auth refresh token rotation integration test

**Priority:** P0 Critical
**Type:** Integration Test

### File to Modify
`apps/api-backend-e2e/src/auth/auth.e2e-spec.ts` (add to existing file)

### Key facts
- Refresh endpoint: `POST /api/auth/refresh`
- Request body: `{ refreshToken: string }` — **body, not cookie**
- Returns: same shape as login response

### Tasks

**Action:** Add a new top-level `describe` block to the existing file:

```typescript
describe('POST /api/auth/refresh', () => {
  let refreshToken: string;

  beforeEach(async () => {
    // Login fresh to get a valid refresh token for each test
    const res = await axios.post('/api/auth/login', {
      identifier: TEST_IDENTIFIER,
      password: TEST_PASSWORD,
    });
    refreshToken = res.data.refresh_token;
  });

  it('should return new access_token and refresh_token when refresh token is valid', async () => {
    const res = await axios.post('/api/auth/refresh', { refreshToken });

    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty('access_token');
    expect(res.data).toHaveProperty('refresh_token');
    // New refresh token should differ from old one (rotation)
    expect(res.data.refresh_token).not.toBe(refreshToken);
  });

  it('should return 401 when refresh token is invalid (random string)', async () => {
    await expect(
      axios.post('/api/auth/refresh', { refreshToken: 'completely-invalid-token' }),
    ).rejects.toMatchObject({ response: { status: 401 } });
  });

  it('should return 401 when the same refresh token is used a second time (rotation)', async () => {
    // Use once — should succeed
    await axios.post('/api/auth/refresh', { refreshToken });

    // Use same token again — old token was deleted from Redis, should fail
    await expect(
      axios.post('/api/auth/refresh', { refreshToken }),
    ).rejects.toMatchObject({ response: { status: 401 } });
  });
});
```

### Acceptance Criteria
- [ ] 3 test cases for refresh
- [ ] Rotation test verifies second use of same token returns 401
- [ ] Request body uses `{ refreshToken }` — not a cookie
- [ ] All tests pass

---

## TST-INT-003: Multi-tenant vendorId isolation integration test

**Priority:** P0 Critical
**Type:** Integration Test

### Context
Verifies that Vendor A's JWT cannot read Vendor B's customers. This is the most important security property of the platform.

### File to Create
`apps/api-backend-e2e/src/auth/multi-tenant.e2e-spec.ts`

### Tasks

#### Task 1: Plan test data
This test needs two separate vendor accounts. Either:
- Use two pre-seeded test vendors (read seed file to find credentials)
- OR create them via `PrismaClient` directly in `beforeAll`

Read `libs/shared/database/prisma/seed.ts` to see what test data exists.

#### Task 2: Write isolation test
**Action:** Create `apps/api-backend-e2e/src/auth/multi-tenant.e2e-spec.ts`

```typescript
import axios from 'axios';
// If seeded data doesn't provide two vendors, import PrismaClient and create them:
// import { PrismaClient } from '@prisma/client';

const VENDOR_A_IDENTIFIER = process.env.VENDOR_A_IDENTIFIER ?? 'vendorA@test.com';
const VENDOR_A_PASSWORD = process.env.VENDOR_A_PASSWORD ?? 'TestPassword123!';
const VENDOR_B_IDENTIFIER = process.env.VENDOR_B_IDENTIFIER ?? 'vendorB@test.com';
const VENDOR_B_PASSWORD = process.env.VENDOR_B_PASSWORD ?? 'TestPassword123!';

describe('Multi-Tenant Isolation', () => {
  let tokenA: string;
  let tokenB: string;
  let customerAId: string;

  beforeAll(async () => {
    // Login as Vendor A
    const resA = await axios.post('/api/auth/login', {
      identifier: VENDOR_A_IDENTIFIER,
      password: VENDOR_A_PASSWORD,
    });
    tokenA = resA.data.access_token;

    // Login as Vendor B
    const resB = await axios.post('/api/auth/login', {
      identifier: VENDOR_B_IDENTIFIER,
      password: VENDOR_B_PASSWORD,
    });
    tokenB = resB.data.access_token;

    // Create a customer under Vendor A using Vendor A's token
    const createRes = await axios.post(
      '/api/customers',
      { name: 'Isolation Test Customer', phoneNumber: '0300-ISOLATION', address: '1 Test St', paymentType: 'CASH' },
      { headers: { Authorization: `Bearer ${tokenA}` } },
    );
    customerAId = createRes.data.id;
  });

  it('Vendor A token should list Customer A in GET /api/customers', async () => {
    const res = await axios.get('/api/customers', {
      headers: { Authorization: `Bearer ${tokenA}` },
    });

    expect(res.data.data.some((c: any) => c.id === customerAId)).toBe(true);
  });

  it('Vendor B token should NOT see Customer A in GET /api/customers', async () => {
    const res = await axios.get('/api/customers', {
      headers: { Authorization: `Bearer ${tokenB}` },
    });

    expect(res.data.data.some((c: any) => c.id === customerAId)).toBe(false);
  });

  it('Vendor B token should get 404 when fetching Customer A by ID', async () => {
    await expect(
      axios.get(`/api/customers/${customerAId}`, {
        headers: { Authorization: `Bearer ${tokenB}` },
      }),
    ).rejects.toMatchObject({ response: { status: 404 } });
  });
});
```

### Acceptance Criteria
- [ ] File exists with 3 test cases
- [ ] Two different vendor tokens are used
- [ ] Direct customer fetch across vendors returns 404
- [ ] All tests pass
