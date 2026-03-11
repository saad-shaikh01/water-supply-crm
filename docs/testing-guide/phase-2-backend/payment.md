# Phase 2 — Backend Unit Tests: Payment

**Module path:** `apps/api-backend/src/app/modules/payment/`
**Prerequisites:** TST-INF-001, TST-INF-002, TST-INF-003

---

## TST-BE-012: PaymentService.initiateRaastQr() unit tests

**Priority:** P0 Critical
**Type:** Unit Test

### Context
`initiateRaastQr` calls the Paymob gateway to create a QR payment session. It must pass the correct amount, store the `PaymentRequest` in the database, and return the checkout URL. A bug here prevents customers from paying.

### File to Create
`apps/api-backend/src/app/modules/payment/payment.service.spec.ts`

### Tasks

#### Task 1: Read PaymentService source
**Action:** Read `apps/api-backend/src/app/modules/payment/payment.service.ts`
Identify:
- All constructor dependencies (Paymob HTTP client, PrismaService, any config)
- The method that initiates Raast QR (`initiateRaastQr` or similar)
- What HTTP call it makes to Paymob
- What it stores in the database
- The return shape

#### Task 2: Write initiateRaastQr tests
**Action:** Create `apps/api-backend/src/app/modules/payment/payment.service.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import { PaymentService } from './payment.service';
import { PrismaService } from '/* correct path */';
import { prismaMock } from '../../../test/prisma-mock';
import { createMockCustomer, mockVendorId } from '../../../test/factories';

// Mock HTTP response from Paymob
const mockPaymobResponse = {
  data: {
    id: 'paymob-order-001',
    payment_key: 'mock-payment-key',
    checkout_url: 'https://accept.paymob.com/checkout/mock',
  },
};

describe('PaymentService', () => {
  let service: PaymentService;
  let httpService: jest.Mocked<HttpService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentService,
        { provide: PrismaService, useValue: prismaMock },
        {
          provide: HttpService,
          useValue: { post: jest.fn().mockReturnValue(of(mockPaymobResponse)) },
        },
        // Add ConfigService or other deps found in Task 1
      ],
    }).compile();

    service = module.get<PaymentService>(PaymentService);
    httpService = module.get(HttpService);
  });

  describe('initiateRaastQr (use actual method name)', () => {
    it('should create a PaymentRequest record and return checkoutUrl', async () => {
      const mockCustomer = createMockCustomer();
      prismaMock.customer.findFirst.mockResolvedValue(mockCustomer);
      prismaMock.paymentRequest.create.mockResolvedValue({
        id: 'pr-001',
        amount: 500,
        checkoutUrl: 'https://accept.paymob.com/checkout/mock',
      } as any);

      const result = await service.initiateRaastQr(mockVendorId, mockCustomer.id, 500);

      expect(prismaMock.paymentRequest.create).toHaveBeenCalled();
      expect(result).toHaveProperty('checkoutUrl');
    });

    it('should throw BadRequestException when amount is 0 or negative', async () => {
      await expect(
        service.initiateRaastQr(mockVendorId, 'customer-001', 0),
      ).rejects.toThrow();
    });

    it('should throw NotFoundException when customer does not belong to vendor', async () => {
      prismaMock.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.initiateRaastQr(mockVendorId, 'wrong-customer', 500),
      ).rejects.toThrow();
    });
  });
});
```

> If `HttpService` is not the http client used, adapt based on Task 1 findings. If Paymob client is a custom service, mock it as `{ post: jest.fn() }`.

### Acceptance Criteria
- [ ] File exists with 3 test cases for `initiateRaastQr`
- [ ] HTTP calls to Paymob are mocked (no real network calls)
- [ ] All tests pass: `npx nx test api-backend --testFile=src/app/modules/payment/payment.service.spec.ts`

---

## TST-BE-013: PaymentService Paymob webhook handler unit tests

**Priority:** P0 Critical
**Type:** Unit Test

### Context
The Paymob webhook is called by Paymob when a payment status changes (PAID, REJECTED, EXPIRED). The service must: verify HMAC signature, update `PaymentRequest.status`, update customer balance, and create a `Transaction` record. Any bug silently breaks payment reconciliation.

### File to Create/Modify
`apps/api-backend/src/app/modules/payment/payment.service.spec.ts` (add to existing file)

### Tasks

#### Task 1: Read webhook handler method
**Action:** Re-read `apps/api-backend/src/app/modules/payment/payment.service.ts`
Find the webhook handler method. Identify:
- How HMAC signature verification works
- What database updates are made on PAID status
- What happens on REJECTED or EXPIRED status
- Whether a `Transaction` ledger entry is created on PAID

#### Task 2: Write webhook tests
**Action:** Add `describe('handlePaymobWebhook')` (use actual method name):

```typescript
describe('handlePaymobWebhook (use actual method name)', () => {
  const buildWebhookPayload = (status: string, hmac: string) => ({
    obj: { id: 'paymob-txn-001', amount_cents: 50000, success: status === 'PAID', order: { id: 'paymob-order-001' } },
    hmac,
  });

  it('should update PaymentRequest to PAID and credit customer balance on successful payment', async () => {
    const mockPaymentRequest = { id: 'pr-001', customerId: 'customer-001', amount: 500, vendorId: mockVendorId };
    prismaMock.paymentRequest.findFirst.mockResolvedValue(mockPaymentRequest as any);
    prismaMock.paymentRequest.update.mockResolvedValue({ ...mockPaymentRequest, status: 'PAID' } as any);
    prismaMock.transaction.create.mockResolvedValue({} as any);

    // Provide a valid HMAC or mock the HMAC verification function
    await service.handlePaymobWebhook(buildWebhookPayload('PAID', 'valid-hmac'));

    expect(prismaMock.paymentRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PAID' }),
      }),
    );
    expect(prismaMock.transaction.create).toHaveBeenCalled();
  });

  it('should update PaymentRequest to REJECTED without crediting balance', async () => {
    const mockPR = { id: 'pr-001', customerId: 'customer-001', amount: 500, vendorId: mockVendorId };
    prismaMock.paymentRequest.findFirst.mockResolvedValue(mockPR as any);
    prismaMock.paymentRequest.update.mockResolvedValue({ ...mockPR, status: 'REJECTED' } as any);

    await service.handlePaymobWebhook(buildWebhookPayload('REJECTED', 'valid-hmac'));

    expect(prismaMock.paymentRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED' }) }),
    );
    expect(prismaMock.transaction.create).not.toHaveBeenCalled();
  });

  it('should throw ForbiddenException or ignore when HMAC signature is invalid', async () => {
    // If service verifies HMAC, provide invalid hash
    // Expect either rejection or silent return (check actual implementation)
  });
});
```

### Acceptance Criteria
- [ ] 3 test cases for webhook handler
- [ ] PAID path verifies both `paymentRequest.update` and `transaction.create` are called
- [ ] REJECTED path verifies `transaction.create` is NOT called
- [ ] All tests pass

---

## TST-BE-014: PaymentService.submitManualPayment() unit tests

**Priority:** P1 High
**Type:** Unit Test

### Context
Manual payments (Raast ID, JazzCash, bank transfer) require screenshot upload to Wasabi S3 and creating a `PaymentRequest` with status `PENDING` for vendor review.

### File to Create/Modify
`apps/api-backend/src/app/modules/payment/payment.service.spec.ts` (add to existing file)

### Tasks

#### Task 1: Read submitManualPayment implementation
**Action:** Re-read `apps/api-backend/src/app/modules/payment/payment.service.ts`
Find the manual payment submission method. Identify:
- How `StorageService.upload()` is called
- What is stored in `PaymentRequest.screenshotPath`
- Initial status of the created `PaymentRequest`

#### Task 2: Write manual payment tests
**Action:** Add `describe('submitManualPayment')`:

```typescript
describe('submitManualPayment', () => {
  let storageService: { upload: jest.Mock; getSignedUrl: jest.Mock };

  beforeEach(() => {
    storageService = { upload: jest.fn().mockResolvedValue({ key: 'payment-screenshots/file.jpg' }), getSignedUrl: jest.fn() };
    // Add storageService to module providers in outer beforeEach
  });

  it('should upload screenshot to S3 and create PaymentRequest with PENDING status', async () => {
    const mockFile: Express.Multer.File = { buffer: Buffer.from(''), originalname: 'receipt.jpg', mimetype: 'image/jpeg' } as any;
    const mockCustomer = createMockCustomer();
    prismaMock.customer.findFirst.mockResolvedValue(mockCustomer);
    prismaMock.paymentRequest.create.mockResolvedValue({ id: 'pr-001', status: 'PENDING' } as any);

    await service.submitManualPayment(mockVendorId, mockCustomer.id, {
      amount: 500,
      method: 'MANUAL_RAAST',
      referenceNo: 'REF123',
    }, mockFile);

    expect(storageService.upload).toHaveBeenCalled();
    expect(prismaMock.paymentRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PENDING', screenshotPath: 'payment-screenshots/file.jpg' }),
      }),
    );
  });

  it('should create PaymentRequest without screenshot when no file is provided', async () => {
    prismaMock.customer.findFirst.mockResolvedValue(createMockCustomer());
    prismaMock.paymentRequest.create.mockResolvedValue({ id: 'pr-001', status: 'PENDING' } as any);

    await service.submitManualPayment(mockVendorId, 'customer-001', {
      amount: 500, method: 'MANUAL_BANK', referenceNo: 'REF456',
    }, undefined);

    expect(storageService.upload).not.toHaveBeenCalled();
    expect(prismaMock.paymentRequest.create).toHaveBeenCalled();
  });
});
```

### Acceptance Criteria
- [ ] 2 test cases for manual payment submission
- [ ] Screenshot upload path is verified in the first test
- [ ] All tests pass
