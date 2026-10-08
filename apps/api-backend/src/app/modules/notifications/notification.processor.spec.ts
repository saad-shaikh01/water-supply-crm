import { NotificationProcessor } from './notification.processor';
import { JOB_NAMES } from '@water-supply-crm/queue';
import { resetGateLogThrottle } from '../../common/tenant-gate/legacy-vendor-gate';

const ENV_KEYS = ['WHATSAPP_GUARD_MODE', 'WHATSAPP_ALLOWED_VENDOR_IDS'] as const;
const BLUE_ICE = 'vendor-blue-ice';
const LOREM = 'vendor-lorem';

const receiptData = {
  customerName: 'Ali',
  customerCode: 'L1',
  deliveryDate: '2026-08-01',
  vendorName: 'Lorem Water',
};

describe('NotificationProcessor — P0 vendor gate', () => {
  const saved: Record<string, string | undefined> = {};
  let whatsapp: { sendTemplate: jest.Mock; sendMessage: jest.Mock; isBlockedForVendor: jest.Mock };
  let pdf: { generate: jest.Mock };
  let prisma: any;
  let processor: NotificationProcessor;

  const job = (name: string, data: Record<string, unknown>) =>
    ({ name, data, timestamp: Date.now(), attemptsMade: 0 }) as any;

  beforeEach(() => {
    ENV_KEYS.forEach((k) => {
      saved[k] = process.env[k];
      delete process.env[k];
    });
    resetGateLogThrottle();
    process.env['WHATSAPP_GUARD_MODE'] = 'enforce';
    process.env['WHATSAPP_ALLOWED_VENDOR_IDS'] = BLUE_ICE;

    // Real WhatsAppService gate semantics, mocked provider side.
    const { isBlocked } = jest.requireActual('../../common/tenant-gate/legacy-vendor-gate');
    whatsapp = {
      sendTemplate: jest.fn().mockResolvedValue(true),
      sendMessage: jest.fn().mockResolvedValue(true),
      isBlockedForVendor: jest.fn((v?: string) => isBlocked(v)),
    };
    pdf = { generate: jest.fn().mockResolvedValue(Buffer.from('%PDF-')) };
    prisma = {
      notificationLog: { create: jest.fn().mockResolvedValue({}) },
      dailySheetItem: { update: jest.fn().mockResolvedValue({}) },
      vendor: { findUnique: jest.fn().mockResolvedValue({ name: 'Lorem Water', address: 'Lahore' }) },
    };
    processor = new NotificationProcessor(whatsapp as any, pdf as any, {} as any, prisma, {} as any);
  });
  afterEach(() => {
    ENV_KEYS.forEach((k) => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    });
  });

  const lastLog = () => prisma.notificationLog.create.mock.calls.at(-1)[0].data;

  it('Blue Ice template job: same template + params, vendorId passed first, logged SENT', async () => {
    await processor.process(job(JOB_NAMES.SEND_WHATSAPP_TEMPLATE, { phoneNumber: '923001234567', templateName: 'payment_received', bodyParams: ['Ali', '100', '0.00'], vendorId: BLUE_ICE }));
    expect(whatsapp.sendTemplate).toHaveBeenCalledWith(BLUE_ICE, '923001234567', 'payment_received', ['Ali', '100', '0.00']);
    expect(lastLog()).toMatchObject({ status: 'SENT', vendorId: BLUE_ICE });
  });

  it('another vendor is blocked in enforce: nothing sent, logged FAILED with a clear reason', async () => {
    await processor.process(job(JOB_NAMES.SEND_WHATSAPP_TEMPLATE, { phoneNumber: '923001234567', templateName: 'payment_received', bodyParams: ['Ali', '100', '0.00'], vendorId: LOREM }));
    expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
    expect(lastLog()).toMatchObject({ status: 'FAILED', vendorId: LOREM });
    expect(lastLog().lastError).toMatch(/not enabled for this vendor/i);
  });

  it('a job without vendorId is blocked in enforce (fail-closed) for text, template, PDF and delivery-failure jobs', async () => {
    await processor.process(job(JOB_NAMES.SEND_WHATSAPP, { phoneNumber: '923001234567', message: 'hi' }));
    await processor.process(job(JOB_NAMES.SEND_WHATSAPP_TEMPLATE, { phoneNumber: '923001234567', templateName: 't', bodyParams: [] }));
    await processor.process(job(JOB_NAMES.SEND_WHATSAPP_PDF, { phoneNumber: '923001234567', receiptData }));
    await processor.process(job(JOB_NAMES.SEND_WHATSAPP_DELIVERY_FAILURE, { phoneNumber: '923001234567', data: { customerName: 'A', customerCode: 'L1', reasonText: 'x' } }));
    expect(whatsapp.sendMessage).not.toHaveBeenCalled();
    expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
    expect(pdf.generate).not.toHaveBeenCalled();
    expect(prisma.notificationLog.create).toHaveBeenCalledTimes(4);
  });

  it('Blue Ice receipt PDF job: legacy branding, delivery_receipt template with the 3 approved params', async () => {
    await processor.process(job(JOB_NAMES.SEND_WHATSAPP_PDF, { phoneNumber: '923001234567', receiptData, vendorId: BLUE_ICE }));
    expect(pdf.generate).toHaveBeenCalledWith(receiptData, expect.objectContaining({ legacy: true }));
    expect(whatsapp.sendTemplate).toHaveBeenCalledWith(
      BLUE_ICE,
      '923001234567',
      'delivery_receipt',
      ['Ali', 'L1', '01 August 2026'],
      { buffer: expect.any(Buffer), filename: expect.stringContaining('.pdf') },
    );
    expect(prisma.vendor.findUnique).not.toHaveBeenCalled();
  });

  it('in shadow mode (the default) another vendor still sends, exactly like before', async () => {
    process.env['WHATSAPP_GUARD_MODE'] = 'shadow';
    await processor.process(job(JOB_NAMES.SEND_WHATSAPP_PDF, { phoneNumber: '923001234567', receiptData, vendorId: LOREM }));
    expect(pdf.generate).toHaveBeenCalledWith(receiptData, expect.objectContaining({ legacy: true }));
    expect(whatsapp.sendTemplate).toHaveBeenCalledTimes(1);
  });
});
