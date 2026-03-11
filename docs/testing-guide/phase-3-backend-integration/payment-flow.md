# Phase 3 — Backend Integration Tests: Payment Flow

**Test location:** `apps/api-backend-e2e/src/payment/`
**Prerequisites:** TST-INT-001 (app bootstrap pattern established), Phase 1 complete

---

## TST-INT-007: Paymob webhook → payment status → balance update integration

**Priority:** P0 Critical
**Type:** Integration Test

### Context
The Paymob webhook is the only way a customer's balance decreases after a QR payment. This test mocks the Paymob webhook call and verifies the full chain: webhook received → PaymentRequest status updated to PAID → customer balance reduced → Transaction record created.

### File to Create
`apps/api-backend-e2e/src/payment/payment-webhook.e2e-spec.ts`

### Tasks

#### Task 1: Read webhook endpoint
**Action:** Read `apps/api-backend/src/app/modules/payment/payment.controller.ts`
Find:
- The Paymob webhook endpoint URL (e.g., `POST /api/payment/webhook` or similar)
- Whether it requires HMAC signature verification
- What the request body shape looks like (Paymob webhook format)

#### Task 2: Read HMAC verification logic
**Action:** Read `apps/api-backend/src/app/modules/payment/payment.service.ts`
Find how HMAC is computed and verified. For tests, you will either:
- Mock the HMAC verification function, OR
- Compute a valid HMAC using the test secret key

#### Task 3: Write webhook integration test
**Action:** Create `apps/api-backend-e2e/src/payment/payment-webhook.e2e-spec.ts`

```typescript
import * as request from 'supertest';
import * as crypto from 'crypto';

// Build a Paymob webhook payload (adjust fields to match actual Paymob format)
function buildWebhookPayload(options: {
  success: boolean;
  paymobOrderId: string;
  amountCents: number;
  hmacSecret: string;
}) {
  const payload = {
    obj: {
      success: options.success,
      amount_cents: options.amountCents,
      order: { id: options.paymobOrderId },
      id: `txn-${Date.now()}`,
    },
  };
  // Compute HMAC (adjust to match actual signature logic in payment.service.ts)
  const hmac = crypto.createHmac('sha512', options.hmacSecret)
    .update(JSON.stringify(payload.obj))
    .digest('hex');

  return { ...payload, hmac };
}

describe('Payment Webhook Integration', () => {
  let app: INestApplication;
  let accessToken: string;
  let customerId: string;
  let paymentRequestId: string;
  let paymobOrderId: string;

  beforeAll(async () => {
    // Bootstrap app
    // Create: vendor + admin, customer with balance=500
    // Create a PaymentRequest with status=PENDING and paymobOrderId
    // Login to get accessToken
  });

  describe('POST /api/payment/webhook (use actual path)', () => {
    it('should update PaymentRequest to PAID and reduce customer balance on success=true', async () => {
      const payload = buildWebhookPayload({
        success: true,
        paymobOrderId,
        amountCents: 30000, // 300 PKR
        hmacSecret: process.env.PAYMOB_HMAC_SECRET || 'test-secret',
      });

      await request(app.getHttpServer())
        .post('/api/payment/webhook')
        .send(payload)
        .expect(200);

      // Verify PaymentRequest status changed to PAID
      const prResponse = await request(app.getHttpServer())
        .get(`/api/payment-requests/${paymentRequestId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(prResponse.body.status).toBe('PAID');

      // Verify customer balance reduced
      const customerResponse = await request(app.getHttpServer())
        .get(`/api/customers/${customerId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(customerResponse.body.balance).toBe(200); // 500 - 300 = 200
    });

    it('should update PaymentRequest to REJECTED without changing balance on success=false', async () => {
      const payload = buildWebhookPayload({
        success: false,
        paymobOrderId,
        amountCents: 30000,
        hmacSecret: process.env.PAYMOB_HMAC_SECRET || 'test-secret',
      });

      await request(app.getHttpServer())
        .post('/api/payment/webhook')
        .send(payload)
        .expect(200);

      const prResponse = await request(app.getHttpServer())
        .get(`/api/payment-requests/${paymentRequestId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(prResponse.body.status).toBe('REJECTED');
    });
  });
});
```

> If HMAC verification in the app requires a specific format, adjust `buildWebhookPayload` to match. If the test environment doesn't have a Paymob HMAC secret, mock the verification in the service or skip HMAC for test mode.

### Acceptance Criteria
- [ ] File exists with 2 test cases
- [ ] Customer balance change is verified end-to-end (webhook → balance)
- [ ] PAID test verifies balance decrease; REJECTED test verifies no change
- [ ] All tests pass: `npx nx e2e api-backend-e2e --testFile=src/payment/payment-webhook.e2e-spec.ts`

---

## TST-INT-008: Manual payment submission → vendor review → approve integration

**Priority:** P1 High
**Type:** Integration Test

### File to Create
`apps/api-backend-e2e/src/payment/manual-payment.e2e-spec.ts`

### Tasks

#### Task 1: Read manual payment and approval endpoints
**Action:** Read `apps/api-backend/src/app/modules/payment/payment.controller.ts`
Find:
- `POST /api/portal/payments/manual` (customer submits manual payment)
- `PATCH /api/payment-requests/:id/approve` or similar (vendor approves)
- `PATCH /api/payment-requests/:id/reject` (vendor rejects)

#### Task 2: Write manual payment flow test
**Action:** Create `apps/api-backend-e2e/src/payment/manual-payment.e2e-spec.ts`

Write these test cases:

1. `it('should create PaymentRequest with PENDING status on manual payment submission')`
   - Use customer portal token (role: CUSTOMER)
   - POST to manual payment endpoint with amount + referenceNo
   - Assert 201, status=PENDING in response

2. `it('should reduce customer balance when vendor approves the PaymentRequest')`
   - Approve the payment request with vendor token
   - Assert customer balance decreased
   - Assert PaymentRequest status = APPROVED

3. `it('should set PaymentRequest to REJECTED without changing balance when vendor rejects')`
   - Create a new PaymentRequest
   - Reject it with vendor token
   - Assert balance unchanged, status=REJECTED

### Acceptance Criteria
- [ ] File exists with 3 test cases
- [ ] Full approval flow verified (customer submits → vendor approves → balance changes)
- [ ] All tests pass
