# Phase 3 — Backend Integration Tests: Customer Portal Flow

**Test location:** `apps/api-backend-e2e/src/customer-portal/`
**Prerequisites:** TST-INT-001 (app bootstrap pattern established), Phase 1 complete

---

## TST-INT-009: Customer portal login → profile fetch integration

**Priority:** P0 Critical
**Type:** Integration Test

### Context
Verifies portal-specific auth flow: a Customer logs in via `POST /api/auth/login` (same endpoint, different role), receives a JWT with role=CUSTOMER, and can access `/api/portal/me`. A vendor admin token must NOT access portal endpoints.

### File to Create
`apps/api-backend-e2e/src/customer-portal/portal-auth.e2e-spec.ts`

### Tasks

#### Task 1: Read portal endpoints
**Action:** Read `apps/api-backend/src/app/modules/customer-portal/customer-portal.controller.ts`
Find:
- `GET /api/portal/me` endpoint and what it returns
- Whether portal endpoints have a `@Roles(UserRole.CUSTOMER)` guard

#### Task 2: Write portal auth tests
**Action:** Create `apps/api-backend-e2e/src/customer-portal/portal-auth.e2e-spec.ts`

```typescript
describe('Customer Portal Auth Integration', () => {
  let app: INestApplication;
  let customerToken: string;
  let vendorAdminToken: string;
  let customerId: string;

  beforeAll(async () => {
    // Bootstrap app
    // Create: vendor + admin user + customer with portalEnabled=true
    // Give customer a portal account (User record with role=CUSTOMER linked to customer)
    // Login as customer → customerToken
    // Login as vendor admin → vendorAdminToken
  });

  describe('POST /api/auth/login (as customer)', () => {
    it('should return 200 with accessToken for valid customer credentials', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'customer@portal.test', password: 'TestPass123!' })
        .expect(200);

      expect(response.body).toHaveProperty('accessToken');
      customerToken = response.body.accessToken;
    });
  });

  describe('GET /api/portal/me', () => {
    it('should return customer profile with financialBalance when customer token is used', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/portal/me')
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(200);

      // Per MEMORY.md: PortalProfile uses phoneNumber and financialBalance
      expect(response.body).toHaveProperty('phoneNumber');
      expect(response.body).toHaveProperty('financialBalance');
    });

    it('should return 401 or 403 when vendor admin token is used on portal endpoint', async () => {
      await request(app.getHttpServer())
        .get('/api/portal/me')
        .set('Authorization', `Bearer ${vendorAdminToken}`)
        .expect((res) => {
          expect([401, 403]).toContain(res.status);
        });
    });

    it('should return 401 when no token is provided', async () => {
      await request(app.getHttpServer())
        .get('/api/portal/me')
        .expect(401);
    });
  });
});
```

### Acceptance Criteria
- [ ] File exists with 4 test cases
- [ ] Response shape matches `PortalProfile` fields (`phoneNumber`, `financialBalance`)
- [ ] Cross-role access test (vendor admin cannot use portal endpoints)
- [ ] All tests pass: `npx nx e2e api-backend-e2e --testFile=src/customer-portal/portal-auth.e2e-spec.ts`

---

## TST-INT-010: Customer portal balance + transactions integration

**Priority:** P1 High
**Type:** Integration Test

### File to Create
`apps/api-backend-e2e/src/customer-portal/portal-balance.e2e-spec.ts`

### Tasks

#### Task 1: Read balance and transaction portal endpoints
**Action:** Read `apps/api-backend/src/app/modules/customer-portal/customer-portal.controller.ts`
Find:
- `GET /api/portal/balance` — response shape
- `GET /api/portal/transactions` — pagination params, response shape
- `GET /api/portal/summary` — response shape

#### Task 2: Write balance tests
**Action:** Create `apps/api-backend-e2e/src/customer-portal/portal-balance.e2e-spec.ts`

Write these test cases using a customer with known seeded data (balance=500, 2 transactions):

1. `it('should return current balance from GET /api/portal/balance')`
   - Assert response has balance field equal to seeded value

2. `it('should return paginated transactions from GET /api/portal/transactions')`
   - Assert `data` array length matches seeded count
   - Assert `meta.total` matches

3. `it('should return delivery schedule from GET /api/portal/summary')`
   - Assert response has `deliverySchedules` array (per MEMORY.md session 14)

### Acceptance Criteria
- [ ] File exists with 3 test cases
- [ ] Balance and transaction count match seeded data
- [ ] All tests pass

---

## TST-INT-011: Customer portal order placement integration

**Priority:** P1 High
**Type:** Integration Test

### File to Create
`apps/api-backend-e2e/src/customer-portal/portal-orders.e2e-spec.ts`

### Tasks

#### Task 1: Read portal order endpoints
**Action:** Read `apps/api-backend/src/app/modules/customer-portal/customer-portal.controller.ts` or `apps/api-backend/src/app/modules/order/`
Find:
- `POST /api/portal/orders` — request body shape, response
- `GET /api/portal/orders` — list endpoint

#### Task 2: Write order placement tests
**Action:** Create `apps/api-backend-e2e/src/customer-portal/portal-orders.e2e-spec.ts`

Write these test cases:

1. `it('should create order with PENDING status via POST /api/portal/orders')`
   - Customer posts order with productId and quantity
   - Assert 201, status=PENDING

2. `it('should list customer orders via GET /api/portal/orders')`
   - Assert the newly created order appears in the list

3. `it('should return 401 when no token provided to order endpoint')`

### Acceptance Criteria
- [ ] File exists with 3 test cases
- [ ] Order appears in list after creation
- [ ] All tests pass

---

## TST-INT-012: Customer portal support ticket creation and reply integration

**Priority:** P2 Medium
**Type:** Integration Test

### File to Create
`apps/api-backend-e2e/src/customer-portal/portal-tickets.e2e-spec.ts`

### Tasks

#### Task 1: Read portal ticket endpoints
**Action:** Read the ticket endpoints at `/api/portal/tickets`
Find create, list, and message-reply routes.

#### Task 2: Write ticket flow tests
**Action:** Create `apps/api-backend-e2e/src/customer-portal/portal-tickets.e2e-spec.ts`

Write these test cases:

1. `it('should create a support ticket via POST /api/portal/tickets')`
   - Assert 201, status=OPEN

2. `it('should add a message to ticket via POST /api/portal/tickets/:id/messages')`
   - Assert message appears in GET /api/portal/tickets/:id response

3. `it('should list customer tickets via GET /api/portal/tickets')`
   - Assert newly created ticket appears in list

### Acceptance Criteria
- [ ] File exists with 3 test cases
- [ ] All tests pass
