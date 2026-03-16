import { getQueueToken } from '@nestjs/bullmq';
import { DeliveryStatus } from '@prisma/client';
import { JOB_NAMES, QUEUE_NAMES } from '@water-supply-crm/queue';
import { DailySheetService } from './daily-sheet.service';
import {
  createPrismaMock,
  createPrismaProvider,
  createTestModule,
  mockPrismaTransaction,
  mockVendorId,
  PrismaMock,
} from '../../../test';
import { AuditService } from '../audit/audit.service';
import { DeliveryIssueService } from '../delivery-issue/delivery-issue.service';
import { FcmService } from '../fcm/fcm.service';
import { LedgerService } from '../transaction/ledger.service';

describe('DailySheetService', () => {
  let service: DailySheetService;
  let prisma: PrismaMock;
  let queue: { add: jest.Mock };
  let ledger: { recordDelivery: jest.Mock };
  let audit: { log: jest.Mock };
  let fcm: { sendToCustomer: jest.Mock };
  let deliveryIssue: { createForItem: jest.Mock };

  beforeEach(async () => {
    prisma = createPrismaMock();
    mockPrismaTransaction(prisma);
    queue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    };
    ledger = {
      recordDelivery: jest.fn().mockResolvedValue({ success: true }),
    };
    audit = {
      log: jest.fn().mockResolvedValue(undefined),
    };
    fcm = {
      sendToCustomer: jest.fn().mockResolvedValue({ sent: 1, failed: 0 }),
    };
    deliveryIssue = {
      createForItem: jest.fn().mockResolvedValue(undefined),
    };

    const module = await createTestModule({
      providers: [
        DailySheetService,
        createPrismaProvider(prisma),
        { provide: LedgerService, useValue: ledger },
        { provide: AuditService, useValue: audit },
        { provide: FcmService, useValue: fcm },
        { provide: DeliveryIssueService, useValue: deliveryIssue },
        {
          provide: getQueueToken(QUEUE_NAMES.DAILY_SHEET_GENERATION),
          useValue: queue,
        },
      ],
    });

    service = module.get(DailySheetService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generate', () => {
    it('queues the current sheet generation job payload', async () => {
      const result = await service.generate(mockVendorId, {
        date: '2025-03-10',
        vanIds: ['van-1', 'van-2'],
      });

      expect(queue.add).toHaveBeenCalledWith(JOB_NAMES.GENERATE_SHEETS, {
        vendorId: mockVendorId,
        date: '2025-03-10',
        vanIds: ['van-1', 'van-2'],
      });
      expect(result).toEqual({ jobId: 'job-1', status: 'queued' });
    });
  });

  describe('submitDelivery', () => {
    it('auto-converts completed zero-drop deliveries to EMPTY_ONLY and records the ledger delta', async () => {
      prisma.dailySheetItem.findUnique.mockResolvedValue({
        id: 'item-1',
        customerId: 'customer-1',
        productId: 'product-1',
        dailySheetId: 'sheet-1',
        dailySheet: { vendorId: mockVendorId },
        customer: {
          customPrices: [{ productId: 'product-1', customPrice: 130 }],
        },
        product: { id: 'product-1', basePrice: 150 },
      } as never);
      prisma.dailySheetItem.update.mockResolvedValue({
        id: 'item-1',
        status: DeliveryStatus.EMPTY_ONLY,
      } as never);

      const result = await service.submitDelivery(mockVendorId, 'item-1', {
        status: DeliveryStatus.COMPLETED,
        filledDropped: 0,
        emptyReceived: 2,
        cashCollected: 0,
      });

      await Promise.resolve();

      expect(prisma.dailySheetItem.update).toHaveBeenCalledWith({
        where: { id: 'item-1' },
        data: {
          status: DeliveryStatus.EMPTY_ONLY,
          filledDropped: 0,
          emptyReceived: 2,
          cashCollected: 0,
          reason: undefined,
          failureCategory: undefined,
          photoUrl: undefined,
        },
      });
      expect(ledger.recordDelivery).toHaveBeenCalledWith({
        vendorId: mockVendorId,
        customerId: 'customer-1',
        productId: 'product-1',
        dailySheetId: 'sheet-1',
        dailySheetItemId: 'item-1',
        filledDropped: 0,
        emptyReceived: 2,
        cashCollected: 0,
        pricePerBottle: 130,
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          vendorId: mockVendorId,
          action: 'DELIVERY_SUBMIT',
          entityId: 'item-1',
        }),
      );
      expect(fcm.sendToCustomer).toHaveBeenCalledWith(
        'customer-1',
        'Delivery Completed',
        '0 bottle(s) delivered. Empty received: 2.',
        { type: 'DELIVERY', itemId: 'item-1' },
      );
      expect(result).toEqual({
        id: 'item-1',
        status: DeliveryStatus.EMPTY_ONLY,
      });
    });

    it('creates a delivery issue for rescheduled deliveries without recording ledger entries', async () => {
      prisma.dailySheetItem.findUnique.mockResolvedValue({
        id: 'item-2',
        customerId: 'customer-2',
        productId: 'product-1',
        dailySheetId: 'sheet-1',
        dailySheet: { vendorId: mockVendorId },
        customer: { customPrices: [] },
        product: { id: 'product-1', basePrice: 150 },
      } as never);
      prisma.dailySheetItem.update.mockResolvedValue({
        id: 'item-2',
        status: DeliveryStatus.RESCHEDULED,
      } as never);

      await service.submitDelivery(mockVendorId, 'item-2', {
        status: DeliveryStatus.RESCHEDULED,
        filledDropped: 0,
        emptyReceived: 0,
        cashCollected: 0,
        reason: 'Customer asked for tomorrow',
      });

      await Promise.resolve();

      expect(ledger.recordDelivery).not.toHaveBeenCalled();
      expect(deliveryIssue.createForItem).toHaveBeenCalledWith(
        mockVendorId,
        'item-2',
      );
    });

    it('throws NotFoundException when the sheet item is outside the vendor scope', async () => {
      prisma.dailySheetItem.findUnique.mockResolvedValue(null);

      await expect(
        service.submitDelivery(mockVendorId, 'missing-item', {
          status: DeliveryStatus.COMPLETED,
          filledDropped: 1,
          emptyReceived: 0,
          cashCollected: 0,
        }),
      ).rejects.toThrow('Sheet item not found');
    });
  });
});
