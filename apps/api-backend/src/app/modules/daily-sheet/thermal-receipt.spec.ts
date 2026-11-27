import { BadRequestException, NotFoundException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import PDFDocument = require('pdfkit');
import { DailySheetService } from './daily-sheet.service';
import { DailySheetController } from './daily-sheet.controller';
import { DailySheetPdfService } from './pdf/daily-sheet-pdf.service';
import { BulkImportService } from './bulk-import.service';
import { DeliveryRepricingService } from './delivery-repricing.service';
import { StorageService } from '../../common/storage/storage.service';
import { VendorBrandingService } from '../vendor-branding/vendor-branding.service';
import { DeliveryReceiptPdfService } from '../whatsapp/delivery-receipt-pdf.service';
import { PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';
import type { DocBranding } from '../../common/pdf/doc-branding';

const VENDOR = 'vendor-lorem';

const lorem: DocBranding = {
  name: 'LOREM WATER',
  payTo: 'LOREM BEVERAGES',
  address: '12 Canal Road, Lahore',
  phones: '0300-1111111',
  logo: null,
  icon: null,
  paymentAccounts: [{ kind: 'JAZZCASH', accountTitle: 'LOREM', accountNumber: '03011111111' }],
};

const completedItem = (over: Record<string, unknown> = {}) => ({
  id: 'item-1',
  customerId: 'cust-1',
  status: 'COMPLETED',
  filledDropped: 3,
  emptyReceived: 2,
  filledReceived: 1,
  cashCollected: 300,
  pricePerBottle: 200,
  financialBalanceAfter: 100,
  bottleBalanceAfter: 4,
  deliveredAt: new Date('2026-11-20T03:54:00Z'),
  customer: { name: 'Nafeesa', customerCode: 'B0235', phoneNumber: null, paymentType: 'CASH', financialBalance: 9999 },
  product: { name: '19L Bottle' },
  dailySheet: { date: new Date('2026-11-20T00:00:00Z'), vendorId: VENDOR, vendor: { name: 'Lorem' }, van: { plateNumber: 'V1' } },
  ...over,
});

function makeService(item: unknown, depositEntries: unknown[] = []) {
  const prisma = {
    dailySheetItem: { findUnique: jest.fn().mockResolvedValue(item) },
    customerDepositEntry: { findMany: jest.fn().mockResolvedValue(depositEntries) },
  };
  const service = Object.create(DailySheetService.prototype) as DailySheetService;
  Object.assign(service as any, { prisma, deliveryReceiptPdf: new DeliveryReceiptPdfService() });
  return { service, prisma };
}

describe('DailySheetService.getDeliveryReceiptData', () => {
  it("returns the delivery's frozen figures, with the amount net of returned filled bottles", async () => {
    const { service } = makeService(completedItem());

    await expect(service.getDeliveryReceiptData(VENDOR, 'item-1')).resolves.toEqual({
      customerName: 'Nafeesa',
      customerCode: 'B0235',
      productName: '19L Bottle',
      van: 'V1',
      filledDropped: 3,
      emptyReceived: 2,
      filledReceived: 1,
      cashCollected: 300,
      pricePerBottle: 200,
      deliveryAmount: 400,
      financialBalanceAfter: 100, // the snapshot, never the live 9999
      bottleBalanceAfter: 4,
      deliveryDate: '2026-11-20',
      deliveryTime: expect.stringMatching(/08:54/),
      previousMonthOutstanding: undefined,
      depositCash: 0,
      depositBottles: 0,
    });
  });

  it('carries the held deposit and the monthly previous outstanding', async () => {
    const monthly = completedItem({
      customer: { name: 'M', customerCode: 'M1', phoneNumber: null, paymentType: 'MONTHLY', financialBalance: 0 },
    });
    const { service } = makeService(monthly, [
      { direction: 'COLLECT', amount: 500, deposit: { type: 'CASH' } },
      { direction: 'COLLECT', amount: 2, deposit: { type: 'BOTTLE' } },
    ]);
    jest.spyOn(service as any, 'getPreviousMonthOutstanding').mockResolvedValue(750);

    const data = await service.getDeliveryReceiptData(VENDOR, 'item-1');

    expect(data).toMatchObject({ depositCash: 500, depositBottles: 2, previousMonthOutstanding: 750 });
  });

  it("never prints the walk-in placeholder van's internal plate", async () => {
    const walkIn = completedItem({
      dailySheet: { date: new Date('2026-11-20T00:00:00Z'), vendorId: VENDOR, vendor: { name: 'Lorem' }, van: { plateNumber: `WALK-IN-${VENDOR}` } },
    });
    const { service } = makeService(walkIn);
    await expect(service.getDeliveryReceiptData(VENDOR, 'item-1')).resolves.toMatchObject({ van: 'Self Pickup' });
  });

  it("does not expose another vendor's delivery", async () => {
    const { service } = makeService(completedItem());
    await expect(service.getDeliveryReceiptData('someone-else', 'item-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s an unknown item', async () => {
    const { service } = makeService(null);
    await expect(service.getDeliveryReceiptData(VENDOR, 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each(['PENDING', 'EMPTY_ONLY', 'NOT_AVAILABLE', 'VOIDED'])('has no receipt for a %s delivery', async (status) => {
    const { service } = makeService(completedItem({ status }));
    await expect(service.getDeliveryReceiptData(VENDOR, 'item-1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('downloaded receipt PDF carries the vendor identity (regression)', () => {
  it('prints the branding it is given and nothing of the legacy default', async () => {
    const texts: string[] = [];
    const original = PDFDocument.prototype.text;
    const spy = jest.spyOn(PDFDocument.prototype, 'text').mockImplementation(function (this: any, ...args: any[]) {
      if (typeof args[0] === 'string') texts.push(args[0]);
      return original.apply(this, args as any);
    } as any);
    try {
      const { service } = makeService(completedItem());
      await service.getDeliveryReceiptPdf(VENDOR, 'item-1', lorem);
    } finally {
      spy.mockRestore();
    }
    const all = texts.join('\n');
    expect(all).toContain('LOREM WATER');
    expect(all).toContain('03011111111');
    expect(all).toContain('Rs. 400.00');
    expect(all).not.toMatch(/dasani|blueice|meezan/i);
  });
});

describe('DailySheetController receipt routes', () => {
  const user = { userId: 'u1', vendorId: VENDOR } as any;
  const make = () => {
    const service = {
      getDeliveryReceiptPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF')),
      getDeliveryReceiptData: jest.fn().mockResolvedValue({ ok: 'data' }),
    };
    const branding = {
      resolveForDocs: jest.fn().mockResolvedValue(lorem),
      resolveForPrint: jest.fn().mockResolvedValue({ ok: 'branding' }),
    };
    const controller = new DailySheetController(service as any, {} as any, {} as any, {} as any, {} as any, branding as any);
    return { controller, service, branding };
  };

  it("resolves the caller's vendor branding for the PDF download", async () => {
    const { controller, service, branding } = make();
    const res = { setHeader: jest.fn(), end: jest.fn() };

    await controller.downloadDeliveryReceipt(user, 'item-1', res as any);

    expect(branding.resolveForDocs).toHaveBeenCalledWith(VENDOR);
    expect(service.getDeliveryReceiptPdf).toHaveBeenCalledWith(VENDOR, 'item-1', lorem);
    expect(res.end).toHaveBeenCalledWith(Buffer.from('%PDF'));
  });

  it('scopes both print endpoints to the caller vendor', async () => {
    const { controller, service, branding } = make();

    await expect(controller.getDeliveryReceiptData(user, 'item-1')).resolves.toEqual({ ok: 'data' });
    await expect(controller.getReceiptPrintBranding(user)).resolves.toEqual({ ok: 'branding' });

    expect(service.getDeliveryReceiptData).toHaveBeenCalledWith(VENDOR, 'item-1');
    expect(branding.resolveForPrint).toHaveBeenCalledWith(VENDOR);
  });

  it.each(['getDeliveryReceiptData', 'getReceiptPrintBranding'] as const)('%s requires daily_sheets:view', (method) => {
    const metadata = Reflect.getMetadata(PERMISSIONS_KEY, DailySheetController.prototype[method]);
    expect(JSON.stringify(metadata)).toContain('daily_sheets:view');
  });
});

describe('receipt routes over HTTP', () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    const service = {
      getDeliveryReceiptData: jest.fn(async (vendorId: string, id: string) => ({ route: 'data', vendorId, id })),
      findOne: jest.fn(async () => ({ route: 'sheet' })),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [DailySheetController],
      providers: [
        { provide: DailySheetService, useValue: service },
        { provide: DailySheetPdfService, useValue: {} },
        { provide: BulkImportService, useValue: {} },
        { provide: StorageService, useValue: {} },
        { provide: DeliveryRepricingService, useValue: {} },
        { provide: VendorBrandingService, useValue: { resolveForPrint: async (vendorId: string) => ({ route: 'branding', vendorId }) } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use((req: any, _res: unknown, next: () => void) => {
      req.user = { userId: 'u1', vendorId: VENDOR };
      next();
    });
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });

  afterAll(() => app?.close());

  it.each([
    ['/daily-sheets/items/item-7/receipt-data', { route: 'data', vendorId: VENDOR, id: 'item-7' }],
    ['/daily-sheets/receipt-print/branding', { route: 'branding', vendorId: VENDOR }],
  ])('GET %s reaches its own handler (not a /:id route)', async (path, body) => {
    const res = await fetch(`${base}${path}`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(body);
  });
});
