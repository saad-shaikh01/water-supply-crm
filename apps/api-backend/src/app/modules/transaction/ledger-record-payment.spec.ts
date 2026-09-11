import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { PrismaService } from '@water-supply-crm/database';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import { TransactionType, PaymentMode } from '@prisma/client';
import { NotificationService } from '../notifications/notification.service';
import { AuditService } from '../audit/audit.service';
import { RecordPaymentDto } from './dto/record-payment.dto';

// ── Minimal Prisma mock ────────────────────────────────────────────────────────
function buildMockPrisma() {
  const db = {
    customer: { update: jest.fn(), findFirst: jest.fn() },
    transaction: { create: jest.fn() },
  };
  (db as any).$transaction = jest.fn().mockImplementation(
    (fn: (tx: typeof db) => unknown) => fn(db),
  );
  return db;
}

const mockCache = {
  invalidateCustomerWallets: jest.fn(),
  invalidateVendorEntity: jest.fn(),
  invalidateOverview: jest.fn(),
  invalidateAnalytics: jest.fn(),
};

const VENDOR_ID = 'vendor-1';
const CUSTOMER = { id: 'customer-1', vendorId: VENDOR_ID };

describe('LedgerService.recordPayment — backdating', () => {
  let service: LedgerService;
  let mockPrisma: ReturnType<typeof buildMockPrisma>;

  beforeEach(async () => {
    mockPrisma = buildMockPrisma();
    mockPrisma.customer.findFirst.mockResolvedValue(CUSTOMER);
    mockPrisma.transaction.create.mockImplementation((args: any) =>
      Promise.resolve({ id: 'tx-1', ...args.data, customer: { id: CUSTOMER.id, name: 'Test', phoneNumber: null, financialBalance: 0 } }),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LedgerService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CacheInvalidationService, useValue: mockCache },
        { provide: NotificationService, useValue: {} },
        { provide: AuditService, useValue: {} },
      ],
    }).compile();

    service = module.get<LedgerService>(LedgerService);
  });

  afterEach(() => jest.clearAllMocks());

  const baseDto = (overrides: Partial<RecordPaymentDto> = {}): RecordPaymentDto => ({
    customerId: CUSTOMER.id,
    amount: 500,
    paymentMode: PaymentMode.CASH,
    ...overrides,
  } as RecordPaymentDto);

  it('omits createdAt entirely when no date is supplied (posts now)', async () => {
    await service.recordPayment(VENDOR_ID, baseDto());

    const data = mockPrisma.transaction.create.mock.calls[0][0].data;
    expect(data.type).toBe(TransactionType.PAYMENT);
    expect('createdAt' in data).toBe(false);
  });

  it("omits createdAt when the date supplied is today's date", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await service.recordPayment(VENDOR_ID, baseDto({ date: today }));

    const data = mockPrisma.transaction.create.mock.calls[0][0].data;
    expect('createdAt' in data).toBe(false);
  });

  it('sets createdAt to local midnight of the given date when it is in the past', async () => {
    await service.recordPayment(VENDOR_ID, baseDto({ date: '2026-01-05' }));

    const data = mockPrisma.transaction.create.mock.calls[0][0].data;
    expect(data.createdAt).toBeInstanceOf(Date);
    expect(data.createdAt.getFullYear()).toBe(2026);
    expect(data.createdAt.getMonth()).toBe(0);
    expect(data.createdAt.getDate()).toBe(5);
    expect(data.createdAt.getHours()).toBe(0);
  });

  it('rejects a future date', async () => {
    const future = new Date();
    future.setDate(future.getDate() + 1);
    const futureStr = future.toISOString().slice(0, 10);

    await expect(service.recordPayment(VENDOR_ID, baseDto({ date: futureStr }))).rejects.toThrow(
      BadRequestException,
    );
    expect(mockPrisma.transaction.create).not.toHaveBeenCalled();
  });

  it('rejects an invalid date string', async () => {
    await expect(
      service.recordPayment(VENDOR_ID, baseDto({ date: 'not-a-date' })),
    ).rejects.toThrow(BadRequestException);
    expect(mockPrisma.transaction.create).not.toHaveBeenCalled();
  });
});
