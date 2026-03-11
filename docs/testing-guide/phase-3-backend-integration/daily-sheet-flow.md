# Phase 3 — Backend Integration Tests: Daily Sheet Flow

**Test location:** `apps/api-backend-e2e/src/daily-sheet/`
**Prerequisites:** TST-INT-001 (app bootstrap pattern established), Phase 1 complete

---

## TST-INT-004: Daily sheet generation end-to-end (API level)

**Priority:** P0 Critical
**Type:** Integration Test

### Context
Tests the full daily sheet generation flow via HTTP: authenticate as vendor admin, POST to generate a sheet for a specific van and date, verify the sheet is created with the correct number of items matching the scheduled customers.

### File to Create
`apps/api-backend-e2e/src/daily-sheet/daily-sheet-generate.e2e-spec.ts`

### Tasks

#### Task 1: Read daily sheet controller
**Action:** Read `apps/api-backend/src/app/modules/daily-sheet/daily-sheet.controller.ts`
Find:
- The route for generating a sheet (POST endpoint, URL, request body shape)
- The route for fetching sheet list (GET endpoint)

#### Task 2: Plan test data setup
For this test, the `beforeAll` must create via Prisma:
1. A vendor + admin user
2. A van with a driver
3. Two customers with `CustomerDeliverySchedule` records for `dayOfWeek=1` (Monday) and `vanId=<van.id>`
4. Login and store `accessToken`

#### Task 3: Write generation test
**Action:** Create `apps/api-backend-e2e/src/daily-sheet/daily-sheet-generate.e2e-spec.ts`

```typescript
import * as request from 'supertest';
// ... bootstrap imports

const TEST_DATE = '2025-03-10'; // A Monday (dayOfWeek=1)

describe('Daily Sheet Generation', () => {
  let app: INestApplication;
  let accessToken: string;
  let vanId: string;
  let sheetId: string;

  beforeAll(async () => {
    // Bootstrap app
    // Create test data via Prisma:
    //   - vendor + admin user
    //   - van
    //   - 2 customers with CustomerDeliverySchedule { dayOfWeek: 1, vanId }
    //   - login to get accessToken
  });

  afterAll(async () => {
    // Clean up test data
    await app.close();
  });

  describe('POST /api/daily-sheets/generate (use actual route)', () => {
    it('should return 201 and create a sheet with 2 items for 2 scheduled customers', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/daily-sheets/generate') // adjust path
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ vanId, date: TEST_DATE })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      sheetId = response.body.id;
    });

    it('should return 409 Conflict when generating a sheet for the same van and date again', async () => {
      await request(app.getHttpServer())
        .post('/api/daily-sheets/generate')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ vanId, date: TEST_DATE })
        .expect(409);
    });
  });

  describe('GET /api/daily-sheets/:id (use actual route)', () => {
    it('should return the generated sheet with items', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/daily-sheets/${sheetId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.items).toHaveLength(2);
    });
  });
});
```

### Acceptance Criteria
- [ ] File exists with 3 test cases
- [ ] Generated sheet has correct number of items matching seeded customers
- [ ] Duplicate generation returns 409
- [ ] All tests pass: `npx nx e2e api-backend-e2e --testFile=src/daily-sheet/daily-sheet-generate.e2e-spec.ts`

---

## TST-INT-005: Daily sheet delivery item update + ledger entry integration

**Priority:** P0 Critical
**Type:** Integration Test

### Context
Verifies the full delivery update chain: PATCH a delivery item → status becomes COMPLETED → a `Transaction` ledger entry is created for the customer charge → customer balance increases.

### File to Create
`apps/api-backend-e2e/src/daily-sheet/daily-sheet-update.e2e-spec.ts`

### Tasks

#### Task 1: Read update item endpoint
**Action:** Read `apps/api-backend/src/app/modules/daily-sheet/daily-sheet.controller.ts`
Find the PATCH endpoint for updating a delivery item.

#### Task 2: Write update + ledger integration test
**Action:** Create `apps/api-backend-e2e/src/daily-sheet/daily-sheet-update.e2e-spec.ts`

```typescript
describe('Daily Sheet Item Update + Ledger', () => {
  let app: INestApplication;
  let accessToken: string;
  let sheetItemId: string;
  let customerId: string;

  beforeAll(async () => {
    // Bootstrap app
    // Create: vendor, van, customer (balance: 0, basePrice: 150), daily sheet with 1 item
    // Store sheetItemId, customerId, accessToken
  });

  describe('PATCH /api/daily-sheets/items/:id', () => {
    it('should update item to COMPLETED and create a debit transaction', async () => {
      await request(app.getHttpServer())
        .patch(`/api/daily-sheets/items/${sheetItemId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ filledDropped: 2, emptiesCollected: 2, status: 'COMPLETED' })
        .expect(200);

      // Verify customer balance was updated
      const customerResponse = await request(app.getHttpServer())
        .get(`/api/customers/${customerId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      // 2 bottles × 150 = 300 charged
      expect(customerResponse.body.balance).toBe(300);
    });

    it('should auto-set EMPTY_ONLY when filledDropped=0', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/daily-sheets/items/${sheetItemId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ filledDropped: 0, emptiesCollected: 1, status: 'COMPLETED' })
        .expect(200);

      expect(response.body.failureCategory).toBe('EMPTY_ONLY');
    });
  });
});
```

### Acceptance Criteria
- [ ] File exists with 2 test cases
- [ ] Customer balance is verified after delivery update (end-to-end balance flow)
- [ ] EMPTY_ONLY auto-detection is verified at the HTTP response level
- [ ] All tests pass

---

## TST-INT-006: Daily sheet close + balance finalization integration

**Priority:** P1 High
**Type:** Integration Test

### File to Create
`apps/api-backend-e2e/src/daily-sheet/daily-sheet-close.e2e-spec.ts`

### Tasks

#### Task 1: Read close/finalize endpoint
**Action:** Read `apps/api-backend/src/app/modules/daily-sheet/daily-sheet.controller.ts`
Find the endpoint that closes a daily sheet (POST or PATCH).

#### Task 2: Write close integration test
**Action:** Create the spec file with these test cases:

1. `it('should close sheet and set status to CLOSED')`
   - Generate a sheet
   - Complete all items
   - POST/PATCH close endpoint
   - Assert sheet status is CLOSED

2. `it('should return 400 or similar when closing a sheet that is already CLOSED')`
   - Close an already-closed sheet
   - Assert error response

3. `it('should not allow delivery item updates after sheet is CLOSED')`
   - Close the sheet
   - Try to PATCH a delivery item
   - Assert 400 or 403

### Acceptance Criteria
- [ ] File exists with 3 test cases
- [ ] Sheet status transitions are verified via GET after each mutation
- [ ] All tests pass
