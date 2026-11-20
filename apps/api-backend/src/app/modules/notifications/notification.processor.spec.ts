import { NotificationProcessor } from './notification.processor';
import { JOB_NAMES } from '@water-supply-crm/queue';
import { resetGateLogThrottle } from '../../common/tenant-gate/legacy-vendor-gate';
import { LEGACY_DOC_BRANDING } from '../../common/pdf/legacy-dasani-branding';

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
  let whatsapp: { sendTemplateDetailed: jest.Mock; sendMessage: jest.Mock; canSendFor: jest.Mock };
  let settings: { isEnabled: jest.Mock };
  let pdf: { generate: jest.Mock };
  let prisma: any;
  let branding: { resolveForDocs: jest.Mock };
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

    // Real gate semantics (an account-less vendor is allowed only when the gate lets it through).
    const { isBlocked } = jest.requireActual('../../common/tenant-gate/legacy-vendor-gate');
    whatsapp = {
      sendTemplateDetailed: jest.fn().mockResolvedValue({ ok: true }),
      sendMessage: jest.fn().mockResolvedValue(true),
      canSendFor: jest.fn(async (v?: string) => !isBlocked(v)),
    };
    pdf = { generate: jest.fn().mockResolvedValue(Buffer.from('%PDF-')) };
    prisma = {
      notificationLog: { create: jest.fn().mockResolvedValue({}) },
      dailySheetItem: { update: jest.fn().mockResolvedValue({}) },
      vendor: { findUnique: jest.fn().mockResolvedValue({ name: 'Lorem Water', address: 'Lahore' }) },
    };
    branding = { resolveForDocs: jest.fn().mockResolvedValue(LEGACY_DOC_BRANDING) };
    settings = { isEnabled: jest.fn().mockResolvedValue(true) };
    processor = new NotificationProcessor(whatsapp as any, pdf as any, {} as any, prisma, {} as any, branding as any, settings as any);
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
    expect(whatsapp.sendTemplateDetailed).toHaveBeenCalledWith(BLUE_ICE, '923001234567', 'payment_received', ['Ali', '100', '0.00']);
    expect(lastLog()).toMatchObject({ status: 'SENT', vendorId: BLUE_ICE });
  });

  it('another vendor is blocked in enforce: nothing sent, logged FAILED with a clear reason', async () => {
    await processor.process(job(JOB_NAMES.SEND_WHATSAPP_TEMPLATE, { phoneNumber: '923001234567', templateName: 'payment_received', bodyParams: ['Ali', '100', '0.00'], vendorId: LOREM }));
    expect(whatsapp.sendTemplateDetailed).not.toHaveBeenCalled();
    expect(lastLog()).toMatchObject({ status: 'FAILED', vendorId: LOREM });
    expect(lastLog().lastError).toMatch(/not enabled for this vendor/i);
  });

  it('a job without vendorId is blocked in enforce (fail-closed) for text, template, PDF and delivery-failure jobs', async () => {
    await processor.process(job(JOB_NAMES.SEND_WHATSAPP, { phoneNumber: '923001234567', message: 'hi' }));
    await processor.process(job(JOB_NAMES.SEND_WHATSAPP_TEMPLATE, { phoneNumber: '923001234567', templateName: 't', bodyParams: [] }));
    await processor.process(job(JOB_NAMES.SEND_WHATSAPP_PDF, { phoneNumber: '923001234567', receiptData }));
    await processor.process(job(JOB_NAMES.SEND_WHATSAPP_DELIVERY_FAILURE, { phoneNumber: '923001234567', data: { customerName: 'A', customerCode: 'L1', reasonText: 'x' } }));
    expect(whatsapp.sendMessage).not.toHaveBeenCalled();
    expect(whatsapp.sendTemplateDetailed).not.toHaveBeenCalled();
    expect(pdf.generate).not.toHaveBeenCalled();
    expect(prisma.notificationLog.create).toHaveBeenCalledTimes(4);
  });

  it('Blue Ice receipt PDF job: legacy branding, delivery_receipt template with the 3 approved params', async () => {
    await processor.process(job(JOB_NAMES.SEND_WHATSAPP_PDF, { phoneNumber: '923001234567', receiptData, vendorId: BLUE_ICE }));
    expect(branding.resolveForDocs).toHaveBeenCalledWith(BLUE_ICE, 'Lorem Water');
    expect(pdf.generate).toHaveBeenCalledWith(receiptData, LEGACY_DOC_BRANDING);
    expect(whatsapp.sendTemplateDetailed).toHaveBeenCalledWith(
      BLUE_ICE,
      '923001234567',
      'delivery_receipt',
      ['Ali', 'L1', '01 August 2026'],
      { buffer: expect.any(Buffer), filename: expect.stringContaining('.pdf') },
    );
      });

  describe('transient failures and vendor switches', () => {
    const pdfJob = (extra: Record<string, unknown> = {}, jobExtra: Record<string, unknown> = {}) =>
      ({ ...job(JOB_NAMES.SEND_WHATSAPP_PDF, { phoneNumber: '923001234567', receiptData, vendorId: BLUE_ICE, type: 'DELIVERY_COMPLETED', ...extra }), ...jobExtra }) as any;
    const transient = { ok: false, retryable: true, stage: 'upload', code: 'ECONNRESET', reason: 'Network error reaching WhatsApp (ECONNRESET): fetch failed' };

    it('a retryable failure on a non-final attempt throws for BullMQ to retry and writes NO log row', async () => {
      whatsapp.sendTemplateDetailed.mockResolvedValue(transient);
      await expect(processor.process(pdfJob({}, { attemptsMade: 0, opts: { attempts: 4 } }))).rejects.toThrow(/PDF not delivered/);
      expect(prisma.notificationLog.create).not.toHaveBeenCalled();
    });

    it('a retryable failure on the FINAL attempt writes one FAILED row (with payload, so the Retry button works)', async () => {
      whatsapp.sendTemplateDetailed.mockResolvedValue(transient);
      await expect(processor.process(pdfJob({}, { attemptsMade: 3, opts: { attempts: 4 } }))).rejects.toThrow();
      expect(prisma.notificationLog.create).toHaveBeenCalledTimes(1);
      expect(lastLog()).toMatchObject({ status: 'FAILED', attemptCount: 4, jobName: JOB_NAMES.SEND_WHATSAPP_PDF });
      expect(lastLog().lastError).toMatch(/not delivered.*ECONNRESET/);
    });

    it('a retryable failure that later succeeds is logged SENT once', async () => {
      whatsapp.sendTemplateDetailed.mockResolvedValue({ ok: true });
      await processor.process(pdfJob({}, { attemptsMade: 2, opts: { attempts: 4 } }));
      expect(prisma.notificationLog.create).toHaveBeenCalledTimes(1);
      expect(lastLog()).toMatchObject({ status: 'SENT', attemptCount: 3 });
    });

    it('a permanent failure is logged FAILED straight away and never thrown (no retry)', async () => {
      whatsapp.sendTemplateDetailed.mockResolvedValue({ ok: false, retryable: false, stage: 'message', code: 132001, reason: 'Template does not exist' });
      await processor.process(pdfJob({}, { attemptsMade: 0, opts: { attempts: 4 } }));
      expect(lastLog()).toMatchObject({ status: 'FAILED' });
      expect(lastLog().lastError).toBe('PDF not delivered — Template does not exist [132001]');
    });

    it("a successful send records Meta's message id (so the delivery webhook can find the row) and no error info", async () => {
      whatsapp.sendTemplateDetailed.mockResolvedValue({ ok: true, messageId: 'wamid.ABC' });
      await processor.process(pdfJob());
      expect(lastLog()).toMatchObject({ status: 'SENT', waMessageId: 'wamid.ABC', errorCode: null, errorStage: null, retryable: null });
    });

    it('a failed send records structured error info: code, stage and whether re-sending is safe', async () => {
      whatsapp.sendTemplateDetailed.mockResolvedValue({ ok: false, retryable: false, stage: 'message', code: 132001, reason: 'no such template' });
      await processor.process(pdfJob());
      expect(lastLog()).toMatchObject({ status: 'FAILED', errorCode: '132001', errorStage: 'message', retryable: false, waMessageId: null });
    });

    it('the final transient failure is recorded as retry-safe (never reached WhatsApp)', async () => {
      whatsapp.sendTemplateDetailed.mockResolvedValue(transient);
      await expect(processor.process(pdfJob({}, { attemptsMade: 3, opts: { attempts: 4 } }))).rejects.toThrow();
      expect(lastLog()).toMatchObject({ errorCode: 'ECONNRESET', errorStage: 'upload', retryable: true });
    });

    it('a job re-queued from the log page links its new row back to the row it retries', async () => {
      await processor.process(pdfJob({ retryOfLogId: 'old-row' }));
      expect(lastLog()).toMatchObject({ status: 'SENT', retryOfId: 'old-row' });
    });

    it('a message type the vendor switched off is not sent and not retried — logged SKIPPED', async () => {
      settings.isEnabled.mockResolvedValue(false);
      await processor.process(pdfJob({}, { attemptsMade: 1, opts: { attempts: 4 } }));
      expect(settings.isEnabled).toHaveBeenCalledWith(BLUE_ICE, 'DELIVERY_COMPLETED', 'WHATSAPP');
      expect(pdf.generate).not.toHaveBeenCalled();
      expect(whatsapp.sendTemplateDetailed).not.toHaveBeenCalled();
      expect(lastLog()).toMatchObject({ status: 'SKIPPED', lastError: 'Disabled by vendor notification settings' });
      expect(lastLog().jobName).toBeUndefined(); // a switched-off send is not retryable from the log page
    });

    it('a job with no notification type is never gated (same as the enqueue-time rule)', async () => {
      settings.isEnabled.mockResolvedValue(false);
      await processor.process(pdfJob({ type: undefined }));
      expect(settings.isEnabled).not.toHaveBeenCalled();
      expect(whatsapp.sendTemplateDetailed).toHaveBeenCalled();
    });

    it('if the settings lookup itself errors the send still goes ahead', async () => {
      settings.isEnabled.mockRejectedValue(new Error('redis down'));
      await processor.process(pdfJob());
      expect(whatsapp.sendTemplateDetailed).toHaveBeenCalled();
      expect(lastLog()).toMatchObject({ status: 'SENT' });
    });
  });

  it('in shadow mode (the default) another vendor still sends, exactly like before', async () => {
    process.env['WHATSAPP_GUARD_MODE'] = 'shadow';
    await processor.process(job(JOB_NAMES.SEND_WHATSAPP_PDF, { phoneNumber: '923001234567', receiptData, vendorId: LOREM }));
    expect(pdf.generate).toHaveBeenCalledWith(receiptData, LEGACY_DOC_BRANDING);
    expect(whatsapp.sendTemplateDetailed).toHaveBeenCalledTimes(1);
  });
});
