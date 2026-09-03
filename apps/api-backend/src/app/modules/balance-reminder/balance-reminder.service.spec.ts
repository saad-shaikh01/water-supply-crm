import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '@water-supply-crm/database';
import { BalanceReminderService } from './balance-reminder.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { NotificationSettingsService } from '../notifications/notification-settings.service';
import { CustomerStatementPdfService } from '../customer/pdf/customer-statement-pdf.service';

/**
 * Phase 0 refactor — behaviour lock.
 *
 * These tests pin the observable behaviour of the (now unified) send pipeline so
 * that the later feature phases cannot silently change it. They deliberately
 * also lock behaviour that is arguably wrong (e.g. single-mode ignoring the
 * balance threshold, preview vs eligible-send divergence) — Phase 0 preserves
 * it, later phases handle it explicitly.
 */

const VALID_PHONE = '+923001234567'; // normalizes to 923001234567 (12 digits)
const JUNK_PHONE = '-'; // normalizes to '' → not sendable

type CustomerRow = {
  id: string;
  name: string;
  customerCode: string;
  phoneNumber: string;
  financialBalance: number;
  isActive?: boolean;
  paymentType?: string;
  createdAt?: Date;
};

function makeRedis(cooldownIds: string[] = []) {
  const onCd = (key: string) => (cooldownIds.some((id) => key.includes(id)) ? 1 : 0);
  return {
    exists: jest.fn((key: string) => Promise.resolve(onCd(key))),
    set: jest.fn().mockResolvedValue('OK'),
    pipeline: jest.fn(() => {
      const keys: string[] = [];
      const chain: any = {
        exists: (key: string) => {
          keys.push(key);
          return chain;
        },
        exec: () => Promise.resolve(keys.map((k) => [null, onCd(k)])),
      };
      return chain;
    }),
  };
}

describe('BalanceReminderService (Phase 0 pipeline)', () => {
  let service: BalanceReminderService;
  let prisma: {
    customer: { findMany: jest.Mock; findFirst: jest.Mock };
    transaction: { findMany: jest.Mock };
    reminderSendLog: { create: jest.Mock; findMany: jest.Mock; count: jest.Mock };
    balanceReminderConfig: { findUnique: jest.Mock; upsert: jest.Mock };
  };
  let whatsapp: { isReady: jest.Mock; sendTemplate: jest.Mock };
  let notifSettings: { isEnabled: jest.Mock };
  let statementPdf: { generate: jest.Mock };
  let redis: ReturnType<typeof makeRedis>;

  beforeEach(async () => {
    prisma = {
      customer: { findMany: jest.fn(), findFirst: jest.fn() },
      transaction: { findMany: jest.fn().mockResolvedValue([]) },
      reminderSendLog: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      balanceReminderConfig: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
    };
    whatsapp = { isReady: jest.fn().mockReturnValue(true), sendTemplate: jest.fn().mockResolvedValue(true) };
    notifSettings = { isEnabled: jest.fn().mockResolvedValue(true) };
    statementPdf = { generate: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BalanceReminderService,
        { provide: PrismaService, useValue: prisma },
        { provide: WhatsAppService, useValue: whatsapp },
        { provide: NotificationSettingsService, useValue: notifSettings },
        { provide: CustomerStatementPdfService, useValue: statementPdf },
      ],
    }).compile();

    service = module.get(BalanceReminderService);
    redis = makeRedis();
    (service as any).redis = redis;
    // never actually wait the 5–12s human-pause in tests
    jest.spyOn(service as any, 'sendDelay').mockResolvedValue(undefined);
  });

  afterEach(() => jest.clearAllMocks());

  // ───────────────────────── preview ladder (classify, preview phase) ─────────

  describe('previewReminders — classification ladder', () => {
    const base: CustomerRow = {
      id: 'c1',
      name: 'Ahmed',
      customerCode: 'L0001',
      phoneNumber: VALID_PHONE,
      financialBalance: 500,
      isActive: true,
      paymentType: 'MONTHLY',
      createdAt: new Date('2020-01-01'),
    };

    const preview = (rows: CustomerRow[], dto: any = {}) => {
      prisma.customer.findMany.mockResolvedValue(rows);
      return service.previewReminders('v1', { mode: 'eligible', month: '2026-08', minBalance: 100, ...dto });
    };

    it('would-send when everything passes', async () => {
      const res = await preview([base]);
      expect(res.totalWouldSend).toBe(1);
      expect(res.wouldSend[0].reason).toBe('would-send');
    });

    it('skipped-inactive wins first', async () => {
      const res = await preview([{ ...base, isActive: false, phoneNumber: JUNK_PHONE }]);
      expect(res.skipped[0].reason).toBe('skipped-inactive');
    });

    it('skipped-no-phone for empty and whitespace-only phone', async () => {
      const res = await preview([
        { ...base, id: 'c-empty', phoneNumber: '' },
        { ...base, id: 'c-ws', phoneNumber: '   ' },
      ]);
      expect(res.skipped.map((s) => s.reason)).toEqual(['skipped-no-phone', 'skipped-no-phone']);
    });

    it('skipped-invalid-phone for junk (non-empty, not sendable)', async () => {
      const res = await preview([{ ...base, phoneNumber: JUNK_PHONE }]);
      expect(res.skipped[0].reason).toBe('skipped-invalid-phone');
    });

    it('skipped-new-customer when createdAt is on/after month end', async () => {
      const res = await preview([{ ...base, createdAt: new Date('2026-09-01T00:00:00') }]);
      expect(res.skipped[0].reason).toBe('skipped-new-customer');
    });

    it('skipped-low-balance when month-end balance < minBalance', async () => {
      const res = await preview([{ ...base, financialBalance: 50 }], { minBalance: 100 });
      expect(res.skipped[0].reason).toBe('skipped-low-balance');
    });

    it('skipped-cooldown from the batched pipeline check', async () => {
      (service as any).redis = makeRedis(['c1']);
      const res = await preview([base]);
      expect(res.skipped[0].reason).toBe('skipped-cooldown');
    });

    it('response envelope shape is unchanged', async () => {
      const res = await preview([base]);
      expect(res).toEqual(
        expect.objectContaining({
          vendorId: 'v1',
          mode: 'eligible',
          minBalance: 100,
          month: '2026-08',
          includeStatement: false,
          paymentType: 'BOTH',
          totalWouldSend: 1,
          totalSkipped: 0,
        }),
      );
      expect(res.wouldSend[0]).toEqual({
        customerId: 'c1',
        name: 'Ahmed',
        customerCode: 'L0001',
        balance: 500,
        phone: VALID_PHONE,
        paymentType: 'MONTHLY',
        reason: 'would-send',
      });
    });

    it('month-end balance nets out post-month transactions', async () => {
      // +200 charge after month end → month-end balance = 500 - 200 = 300
      prisma.transaction.findMany.mockResolvedValueOnce([{ customerId: 'c1', amount: 200 }]);
      const res = await preview([base]);
      expect(res.wouldSend[0].balance).toBe(300);
    });
  });

  // ───────────────────────── eligible send (processVendorReminders) ───────────

  describe('processVendorReminders — eligible send', () => {
    const rows = (over: Partial<CustomerRow>[] = [{}]): CustomerRow[] =>
      over.map((o, i) => ({
        id: `c${i + 1}`,
        name: `Cust ${i + 1}`,
        customerCode: `L000${i + 1}`,
        phoneNumber: VALID_PHONE,
        financialBalance: 500,
        createdAt: new Date('2020-01-01'),
        ...o,
      }));

    it('sends to eligible customers and records ONE aggregate log', async () => {
      prisma.customer.findMany.mockResolvedValue(rows([{}, {}]));
      const res = await service.processVendorReminders('v1', 100, false, '2026-08', false, undefined, false, 'manual');

      expect(res.sent).toBe(2);
      expect(res.skipped).toBe(0);
      expect(whatsapp.sendTemplate).toHaveBeenCalledTimes(2);
      expect(redis.set).toHaveBeenCalledTimes(2);
      expect(redis.set).toHaveBeenLastCalledWith(expect.stringContaining('balance-reminder-cooldown:v1:'), '1', 'EX', 82800);
      expect(prisma.reminderSendLog.create).toHaveBeenCalledTimes(1);
    });

    it('log payload keeps every eligible-mode field', async () => {
      prisma.customer.findMany.mockResolvedValue(rows([{}]));
      await service.processVendorReminders('v1', 150, false, '2026-08', true, 'MONTHLY', true, 'manual', 'van-1', 3, ['other']);

      expect(prisma.reminderSendLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          vendorId: 'v1',
          trigger: 'manual',
          mode: 'eligible',
          kind: 'REMINDER',
          month: '2026-08',
          includeStatement: true,
          dryRun: false,
          minBalance: 150,
          paymentType: 'MONTHLY',
          vanId: 'van-1',
          dayOfWeek: 3,
          force: true,
        }),
      });
    });

    it('low-balance customers are pre-filtered: absent from results AND skipped count', async () => {
      prisma.customer.findMany.mockResolvedValue(rows([{ financialBalance: 500 }, { financialBalance: 40 }]));
      const res = await service.processVendorReminders('v1', 100, false, '2026-08', false, undefined, false, 'manual');

      expect(res.sent).toBe(1);
      expect(res.skipped).toBe(0);
      expect(res.customers).toHaveLength(1);
      expect(res.customers.map((c: any) => c.status)).toEqual(['sent']);
    });

    it('skipped-new-customer inside the send loop', async () => {
      prisma.customer.findMany.mockResolvedValue(rows([{ createdAt: new Date('2026-09-05') }]));
      const res = await service.processVendorReminders('v1', 100, false, '2026-08', false, undefined, false, 'manual');
      expect(res.customers[0].status).toBe('skipped-new-customer');
      expect(res.customers[0].statementUrl).toBeNull();
      expect(res.sent).toBe(0);
      expect(res.skipped).toBe(1);
    });

    it('skipped-excluded when the id is in excludeCustomerIds', async () => {
      prisma.customer.findMany.mockResolvedValue(rows([{ id: 'c1' }]));
      const res = await service.processVendorReminders('v1', 100, false, '2026-08', false, undefined, false, 'manual', undefined, undefined, ['c1']);
      expect(res.customers[0].status).toBe('skipped-excluded');
      expect(res.sent).toBe(0);
    });

    it('dry run: everything would-send, sent=0, no log written', async () => {
      prisma.customer.findMany.mockResolvedValue(rows([{}, {}]));
      const res = await service.processVendorReminders('v1', 100, true, '2026-08', true, undefined, false, 'manual');

      expect(res.sent).toBe(0);
      expect(res.skipped).toBe(2);
      expect(res.customers.every((c: any) => c.status === 'would-send')).toBe(true);
      expect(res.customers[0].statementUrl).toBe('(statement PDF attached at send time)');
      expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
      expect(prisma.reminderSendLog.create).not.toHaveBeenCalled();
    });

    it('dry run would-send row: statementUrl null when includeStatement=false', async () => {
      prisma.customer.findMany.mockResolvedValue(rows([{}]));
      const res = await service.processVendorReminders('v1', 100, true, '2026-08', false, undefined, false, 'manual');
      expect(res.customers[0].statementUrl).toBeNull();
    });

    it('connectivity abort marks the current + all following customers skipped-disconnected', async () => {
      whatsapp.isReady.mockReturnValueOnce(true).mockReturnValue(false);
      prisma.customer.findMany.mockResolvedValue(rows([{}, {}, {}]));
      const res = await service.processVendorReminders('v1', 100, false, '2026-08', false, undefined, false, 'manual');

      expect(res.sent).toBe(1);
      expect(res.skipped).toBe(2);
      expect(res.customers.map((c: any) => c.status)).toEqual(['sent', 'skipped-disconnected', 'skipped-disconnected']);
      // log is still written (this is not a dry run)
      expect(prisma.reminderSendLog.create).toHaveBeenCalledTimes(1);
    });

    it('cooldown skips unless force; force bypasses the redis check entirely', async () => {
      (service as any).redis = makeRedis(['c1']);
      const cdRedis = (service as any).redis;
      prisma.customer.findMany.mockResolvedValue(rows([{ id: 'c1' }]));

      const skippedRes = await service.processVendorReminders('v1', 100, false, '2026-08', false, undefined, false, 'manual');
      expect(skippedRes.customers[0].status).toBe('skipped-cooldown');
      expect(skippedRes.sent).toBe(0);

      cdRedis.exists.mockClear();
      const forcedRes = await service.processVendorReminders('v1', 100, false, '2026-08', false, undefined, true, 'manual');
      expect(cdRedis.exists).not.toHaveBeenCalled();
      expect(forcedRes.sent).toBe(1);
    });

    it('dispatch failure → status failed, no cooldown SET, counts as skipped', async () => {
      whatsapp.sendTemplate.mockResolvedValue(false);
      prisma.customer.findMany.mockResolvedValue(rows([{}]));
      const res = await service.processVendorReminders('v1', 100, false, '2026-08', false, undefined, false, 'manual');

      expect(res.customers[0].status).toBe('failed');
      expect(res.customers[0].statementUrl).toBeNull();
      expect(res.sent).toBe(0);
      expect(res.skipped).toBe(1);
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('sent row carries statementUrl null (every result row has the key)', async () => {
      prisma.customer.findMany.mockResolvedValue(rows([{}]));
      const res = await service.processVendorReminders('v1', 100, false, '2026-08', false, undefined, false, 'manual');
      expect(res.customers[0].status).toBe('sent');
      expect(res.customers[0].statementUrl).toBeNull();
    });

    it('sendDelay runs between customers but not after the last', async () => {
      prisma.customer.findMany.mockResolvedValue(rows([{}, {}, {}]));
      await service.processVendorReminders('v1', 100, false, '2026-08', false, undefined, false, 'manual');
      expect((service as any).sendDelay).toHaveBeenCalledTimes(2);
    });

    it('no candidates → empty envelope, no log', async () => {
      prisma.customer.findMany.mockResolvedValue([]);
      const res = await service.processVendorReminders('v1', 100, false, '2026-08', false, undefined, false, 'manual');
      expect(res).toEqual({ vendorId: 'v1', sent: 0, skipped: 0, dryRun: false, month: '2026-08', includeStatement: false, paymentType: 'BOTH', customers: [] });
      expect(prisma.reminderSendLog.create).not.toHaveBeenCalled();
    });

    it('all candidates below threshold → empty envelope, no log', async () => {
      prisma.customer.findMany.mockResolvedValue(rows([{ financialBalance: 10 }, { financialBalance: 20 }]));
      const res = await service.processVendorReminders('v1', 100, false, '2026-08', false, undefined, false, 'manual');
      expect(res.customers).toEqual([]);
      expect(res.sent).toBe(0);
      expect(prisma.reminderSendLog.create).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────── single / selected send (sendTargeted) ───────────

  describe('sendTargeted — single / selected', () => {
    const one = (over: Partial<CustomerRow> = {}): CustomerRow => ({
      id: 'c1',
      name: 'Ahmed',
      customerCode: 'L0001',
      phoneNumber: VALID_PHONE,
      financialBalance: 500,
      ...over,
    });

    it('empty customerIds → error envelope, no query', async () => {
      const res: any = await service.sendTargeted('v1', { mode: 'single', customerIds: [] } as any);
      expect(res.error).toBe('customerIds is required for mode=single or mode=selected');
      expect(prisma.customer.findMany).not.toHaveBeenCalled();
    });

    it('no rows found → empty envelope without error / paymentType', async () => {
      prisma.customer.findMany.mockResolvedValue([]);
      const res: any = await service.sendTargeted('v1', { mode: 'single', customerIds: ['nope'], month: '2026-08' } as any);
      expect(res).toEqual({ vendorId: 'v1', sent: 0, skipped: 0, dryRun: false, month: '2026-08', includeStatement: false, customers: [] });
    });

    it('does NOT skip low balance (documented divergence vs preview)', async () => {
      prisma.customer.findMany.mockResolvedValue([one({ financialBalance: 5 })]);
      const res: any = await service.sendTargeted('v1', { mode: 'single', customerIds: ['c1'], month: '2026-08', minBalance: 100 } as any);
      expect(res.sent).toBe(1);
      expect(res.customers[0].status).toBe('sent');
    });

    it('does NOT skip new customers (createdAt is not consulted)', async () => {
      prisma.customer.findMany.mockResolvedValue([one({ createdAt: new Date('2030-01-01') } as any)]);
      const res: any = await service.sendTargeted('v1', { mode: 'selected', customerIds: ['c1'], month: '2026-08' } as any);
      expect(res.sent).toBe(1);
    });

    it('junk phone → skipped-invalid-phone', async () => {
      prisma.customer.findMany.mockResolvedValue([one({ phoneNumber: JUNK_PHONE })]);
      const res: any = await service.sendTargeted('v1', { mode: 'single', customerIds: ['c1'], month: '2026-08' } as any);
      expect(res.customers[0].status).toBe('skipped-invalid-phone');
      expect(res.sent).toBe(0);
    });

    it('log payload omits minBalance / paymentType / vanId / dayOfWeek', async () => {
      prisma.customer.findMany.mockResolvedValue([one()]);
      await service.sendTargeted('v1', { mode: 'single', customerIds: ['c1'], month: '2026-08' } as any);

      const data = prisma.reminderSendLog.create.mock.calls[0][0].data;
      expect(data).toEqual(
        expect.objectContaining({ vendorId: 'v1', trigger: 'manual', mode: 'single', kind: 'REMINDER', month: '2026-08', force: false }),
      );
      expect(data).not.toHaveProperty('minBalance');
      expect(data).not.toHaveProperty('paymentType');
      expect(data).not.toHaveProperty('vanId');
      expect(data).not.toHaveProperty('dayOfWeek');
    });

    it('return envelope has no paymentType key', async () => {
      prisma.customer.findMany.mockResolvedValue([one()]);
      const res: any = await service.sendTargeted('v1', { mode: 'single', customerIds: ['c1'], month: '2026-08' } as any);
      expect(res).not.toHaveProperty('paymentType');
    });

    it('mode=eligible delegates to processVendorReminders (kind REMINDER by default)', async () => {
      const spy = jest.spyOn(service, 'processVendorReminders').mockResolvedValue({} as any);
      await service.sendTargeted('v1', { mode: 'eligible', month: '2026-08', minBalance: 100 } as any);
      expect(spy).toHaveBeenCalledWith('v1', 100, false, '2026-08', false, undefined, false, 'manual', undefined, undefined, undefined, 'REMINDER');
    });
  });

  // ───────────────────────── preview vs send parity ─────────────────────────

  describe('preview / send parity', () => {
    it('preview reports skipped-low-balance where eligible send silently drops the same customer', async () => {
      const row: CustomerRow = {
        id: 'c1', name: 'A', customerCode: 'L1', phoneNumber: VALID_PHONE,
        financialBalance: 40, isActive: true, paymentType: 'CASH', createdAt: new Date('2020-01-01'),
      };
      prisma.customer.findMany.mockResolvedValue([row]);
      const preview = await service.previewReminders('v1', { mode: 'eligible', month: '2026-08', minBalance: 100 });
      expect(preview.skipped[0].reason).toBe('skipped-low-balance');

      prisma.customer.findMany.mockResolvedValue([{ ...row, isActive: undefined, paymentType: undefined }]);
      const send = await service.processVendorReminders('v1', 100, false, '2026-08', false, undefined, false, 'manual');
      expect(send.customers).toEqual([]);
    });
  });

  // ═════════════════════════ Phase 1 — Statement-only mode ═══════════════════

  describe('Phase 1 — statement-only mode', () => {
    const row = (over: Partial<CustomerRow>[] = [{}]): CustomerRow[] =>
      over.map((o, i) => ({
        id: `c${i + 1}`,
        name: `Cust ${i + 1}`,
        customerCode: `L000${i + 1}`,
        phoneNumber: VALID_PHONE,
        financialBalance: 500,
        isActive: true,
        paymentType: 'MONTHLY',
        createdAt: new Date('2020-01-01'),
        ...o,
      }));

    /** Make generateStatementPdf() succeed. */
    const givePdf = (c: Partial<CustomerRow> = {}) => {
      prisma.customer.findFirst.mockResolvedValue({
        id: 'c1', name: 'Cust 1', customerCode: 'L0001', financialBalance: 500, ...c,
      });
      statementPdf.generate.mockResolvedValue(Buffer.from('%PDF-1.4 fake'));
    };

    describe('resolveSendKind', () => {
      it('maps DTO strings to the enum', () => {
        const rk = (v: any) => (service as any).resolveSendKind(v);
        expect(rk(undefined)).toBe('REMINDER');
        expect(rk('reminder')).toBe('REMINDER');
        expect(rk('statement_only')).toBe('STATEMENT_ONLY');
        expect(rk('garbage')).toBe('REMINDER');
      });
    });

    describe('preview', () => {
      it('drops the low-balance rung: a below-threshold customer is would-send', async () => {
        prisma.customer.findMany.mockResolvedValue(row([{ financialBalance: 5 }]));
        const res = await service.previewReminders('v1', { sendKind: 'statement_only', mode: 'eligible', month: '2026-08', minBalance: 100 } as any);
        expect(res.totalWouldSend).toBe(1);
        expect(res.wouldSend[0].reason).toBe('would-send');
        expect(res.includeStatement).toBe(true);
      });

      it('still skips inactive / invalid-phone / new-customer / cooldown', async () => {
        (service as any).redis = makeRedis(['c4']);
        prisma.customer.findMany.mockResolvedValue(row([
          { id: 'c1', isActive: false },
          { id: 'c2', phoneNumber: JUNK_PHONE },
          { id: 'c3', createdAt: new Date('2026-09-02') },
          { id: 'c4' },
        ]));
        const res = await service.previewReminders('v1', { sendKind: 'statement_only', mode: 'eligible', month: '2026-08' } as any);
        const byId = Object.fromEntries(res.skipped.map((s) => [s.customerId, s.reason]));
        expect(byId).toEqual({
          c1: 'skipped-inactive',
          c2: 'skipped-invalid-phone',
          c3: 'skipped-new-customer',
          c4: 'skipped-cooldown',
        });
      });
    });

    describe('eligible send', () => {
      it('no balance pre-filter: a below-threshold customer still gets the neutral template', async () => {
        givePdf();
        prisma.customer.findMany.mockResolvedValue(row([{ id: 'c1', financialBalance: 5 }]));
        const res = await service.processVendorReminders('v1', 100, false, '2026-08', false, undefined, false, 'manual', undefined, undefined, undefined, 'STATEMENT_ONLY' as any);

        expect(res.sent).toBe(1);
        expect(res.customers[0].status).toBe('sent');
        expect(whatsapp.sendTemplate).toHaveBeenCalledWith(
          VALID_PHONE,
          'monthly_statement_neutral',
          ['Cust 1', expect.stringContaining('2026')],
          expect.objectContaining({ filename: expect.any(String) }),
        );
      });

      it('never uses a reminder / balance template', async () => {
        givePdf();
        prisma.customer.findMany.mockResolvedValue(row([{ id: 'c1', financialBalance: 5000 }]));
        await service.processVendorReminders('v1', 100, false, '2026-08', false, undefined, false, 'manual', undefined, undefined, undefined, 'STATEMENT_ONLY' as any);
        const templates = whatsapp.sendTemplate.mock.calls.map((c) => c[1]);
        expect(templates).toEqual(['monthly_statement_neutral']);
      });

      it('PDF generation miss → skipped-pdf-failed, counts as skipped, no cooldown SET, no send', async () => {
        prisma.customer.findFirst.mockResolvedValue(undefined); // generateStatementPdf returns null
        prisma.customer.findMany.mockResolvedValue(row([{ id: 'c1' }]));
        const res = await service.processVendorReminders('v1', 100, false, '2026-08', false, undefined, false, 'manual', undefined, undefined, undefined, 'STATEMENT_ONLY' as any);

        expect(res.customers[0].status).toBe('skipped-pdf-failed');
        expect(res.customers[0].statementUrl).toBeNull();
        expect(res.sent).toBe(0);
        expect(res.skipped).toBe(1);
        expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
        expect(redis.set).not.toHaveBeenCalled();
      });

      it('vendor master switch off → failed (no send)', async () => {
        notifSettings.isEnabled.mockResolvedValue(false);
        givePdf();
        prisma.customer.findMany.mockResolvedValue(row([{ id: 'c1' }]));
        const res = await service.processVendorReminders('v1', 100, false, '2026-08', false, undefined, false, 'manual', undefined, undefined, undefined, 'STATEMENT_ONLY' as any);
        expect(res.customers[0].status).toBe('failed');
        expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
      });

      it('log records kind STATEMENT_ONLY and includeStatement true (even if caller passed false)', async () => {
        givePdf();
        prisma.customer.findMany.mockResolvedValue(row([{ id: 'c1' }]));
        await service.processVendorReminders('v1', 100, false, '2026-08', false, undefined, false, 'manual', undefined, undefined, undefined, 'STATEMENT_ONLY' as any);

        expect(prisma.reminderSendLog.create).toHaveBeenCalledWith({
          data: expect.objectContaining({ mode: 'eligible', kind: 'STATEMENT_ONLY', includeStatement: true }),
        });
      });

      it('still honours new-customer / excluded / cooldown / disconnect', async () => {
        givePdf();
        prisma.customer.findMany.mockResolvedValue(row([
          { id: 'c1', createdAt: new Date('2026-09-10') },
          { id: 'c2' },
        ]));
        const res = await service.processVendorReminders('v1', 100, false, '2026-08', false, undefined, false, 'manual', undefined, undefined, ['c2'], 'STATEMENT_ONLY' as any);
        const byId = Object.fromEntries(res.customers.map((c: any) => [c.customerId, c.status]));
        expect(byId).toEqual({ c1: 'skipped-new-customer', c2: 'skipped-excluded' });
      });
    });

    describe('via sendTargeted', () => {
      it('eligible: forces includeStatement true and passes kind through', async () => {
        const spy = jest.spyOn(service, 'processVendorReminders').mockResolvedValue({} as any);
        await service.sendTargeted('v1', { sendKind: 'statement_only', mode: 'eligible', month: '2026-08', minBalance: 100, includeStatement: false } as any);
        expect(spy).toHaveBeenCalledWith('v1', 100, false, '2026-08', true, undefined, false, 'manual', undefined, undefined, undefined, 'STATEMENT_ONLY');
      });

      it('single: sends the neutral template and logs kind', async () => {
        givePdf();
        prisma.customer.findMany.mockResolvedValue([{ id: 'c1', name: 'Cust 1', customerCode: 'L0001', phoneNumber: VALID_PHONE, financialBalance: 5 }]);
        const res: any = await service.sendTargeted('v1', { sendKind: 'statement_only', mode: 'single', customerIds: ['c1'], month: '2026-08' } as any);

        expect(res.sent).toBe(1);
        expect(whatsapp.sendTemplate).toHaveBeenCalledWith(VALID_PHONE, 'monthly_statement_neutral', ['Cust 1', expect.stringContaining('2026')], expect.anything());
        expect(prisma.reminderSendLog.create).toHaveBeenCalledWith({
          data: expect.objectContaining({ mode: 'single', kind: 'STATEMENT_ONLY', includeStatement: true }),
        });
      });
    });

    describe('REMINDER path is unchanged', () => {
      it('sendKind omitted → REMINDER template branch + kind REMINDER in log', async () => {
        prisma.customer.findMany.mockResolvedValue(row([{ id: 'c1', financialBalance: 500 }]));
        const res = await service.processVendorReminders('v1', 100, false, '2026-08', false, undefined, false, 'manual');

        expect(res.sent).toBe(1);
        expect(whatsapp.sendTemplate).toHaveBeenCalledWith(VALID_PHONE, 'balance_reminder', ['Cust 1', '500.00']);
        expect(prisma.reminderSendLog.create).toHaveBeenCalledWith({
          data: expect.objectContaining({ kind: 'REMINDER' }),
        });
      });

      it('sendKind "reminder" is treated exactly like omitted', async () => {
        prisma.customer.findMany.mockResolvedValue(row([{ id: 'c1', financialBalance: 500 }]));
        const res: any = await service.sendTargeted('v1', { sendKind: 'reminder', mode: 'single', customerIds: ['c1'], month: '2026-08' } as any);
        expect(res.sent).toBe(1);
        expect(whatsapp.sendTemplate).toHaveBeenCalledWith(VALID_PHONE, 'balance_reminder', ['Cust 1', '500.00']);
      });
    });
  });

  // ═════════════════════════ Phase 2 — Overdue Warning ══════════════════════

  describe('Phase 2 — overdue warning', () => {
    const MONTH = '2026-08';
    // stable cutoff so tests control "too soon" purely by the statement's createdAt
    const CUTOFF = new Date('2026-08-25T00:00:00Z');
    const OLD_STATEMENT = new Date('2026-08-10T09:00:00Z'); // before cutoff → old enough
    const NEW_STATEMENT = new Date('2026-08-28T09:00:00Z'); // after cutoff → too soon

    type WCustomer = {
      id: string; name: string; customerCode: string; phoneNumber: string;
      financialBalance: number; createdAt?: Date; paymentRequests?: { id: string }[];
    };

    const wcust = (over: Partial<WCustomer> = {}): WCustomer => ({
      id: 'c1', name: 'Cust 1', customerCode: 'L0001', phoneNumber: VALID_PHONE,
      financialBalance: 500, createdAt: new Date('2020-01-01'), paymentRequests: [], ...over,
    });

    /** statement-log rows: one send, each listed customer 'sent' at `at`. */
    const statementLog = (customerIds: string[], at: Date = OLD_STATEMENT) => ({
      createdAt: at,
      details: customerIds.map((id) => ({ customerId: id, status: 'sent' })),
    });
    const warnLog = (customerIds: string[]) => ({
      details: customerIds.map((id) => ({ customerId: id, status: 'sent' })),
    });

    /** wire reminderSendLog.findMany to answer statement-query vs warning-query. */
    const setLogs = (statementLogs: any[], warnLogs: any[] = []) => {
      prisma.reminderSendLog.findMany.mockImplementation((args: any) =>
        Promise.resolve(args?.where?.kind === 'WARNING' ? warnLogs : statementLogs),
      );
    };

    beforeEach(() => {
      // deterministic cutoff for every warning path
      jest.spyOn(service as any, 'warningCutoff').mockReturnValue(CUTOFF);
      notifSettings.isEnabled.mockResolvedValue(true);
    });

    // ── config ──────────────────────────────────────────────────────────────

    describe('getConfig / updateConfig', () => {
      it('returns defaults when no row', async () => {
        prisma.balanceReminderConfig.findUnique.mockResolvedValue(null);
        expect(await service.getConfig('v1')).toEqual({ warningDelayDays: 3, warningMinBalance: 100, autoWarningsEnabled: false });
      });

      it('returns stored values', async () => {
        prisma.balanceReminderConfig.findUnique.mockResolvedValue({ warningDelayDays: 7, warningMinBalance: 250, autoWarningsEnabled: false });
        expect(await service.getConfig('v1')).toEqual({ warningDelayDays: 7, warningMinBalance: 250, autoWarningsEnabled: false });
      });

      it('updateConfig upserts only the provided fields', async () => {
        prisma.balanceReminderConfig.findUnique.mockResolvedValue({ warningDelayDays: 5, warningMinBalance: 100, autoWarningsEnabled: false });
        await service.updateConfig('v1', { warningDelayDays: 5 });
        expect(prisma.balanceReminderConfig.upsert).toHaveBeenCalledWith({
          where: { vendorId: 'v1' },
          create: { vendorId: 'v1', warningDelayDays: 5 },
          update: { warningDelayDays: 5 },
        });
      });
    });

    // ── warningCutoff math (real implementation) ─────────────────────────────

    describe('warningCutoff', () => {
      it('floors to Asia/Karachi midnight then subtracts delayDays', () => {
        jest.restoreAllMocks(); // drop the spy for this one
        jest.spyOn(service as any, 'sendDelay').mockResolvedValue(undefined);
        const now = Date.UTC(2026, 7, 10, 9, 0, 0); // 2026-08-10 09:00 UTC = 14:00 PKT
        const cutoff = (service as any).warningCutoff(3, now) as Date;
        // Karachi midnight of 2026-08-10 is 2026-08-09 19:00 UTC; minus 3 days:
        expect(cutoff.toISOString()).toBe(new Date(Date.UTC(2026, 7, 6, 19, 0, 0)).toISOString());
      });
    });

    // ── eligibility (via previewReminders sendKind=warning) ──────────────────

    describe('preview eligibility', () => {
      const preview = (customers: WCustomer[], statementLogs: any[], warnLogs: any[] = []) => {
        setLogs(statementLogs, warnLogs);
        prisma.customer.findMany.mockResolvedValue(customers);
        return service.previewReminders('v1', { sendKind: 'warning', mode: 'eligible', month: MONTH } as any);
      };

      it('would-send: statement old enough, still owes, no pending payment, not warned', async () => {
        const res: any = await preview([wcust()], [statementLog(['c1'])]);
        expect(res.kind).toBe('WARNING');
        expect(res.warningDelayDays).toBe(3);
        expect(res.totalWouldSend).toBe(1);
        expect(res.wouldSend[0].reason).toBe('would-send');
        expect(res.wouldSend[0].balance).toBe(500);
      });

      it('no statement this cycle → not in the audience at all', async () => {
        const res: any = await preview([wcust()], []); // empty statement logs
        expect(res.totalWouldSend + res.totalSkipped).toBe(0);
      });

      it('skipped-too-soon when the statement is newer than the cutoff', async () => {
        const res: any = await preview([wcust()], [statementLog(['c1'], NEW_STATEMENT)]);
        expect(res.skipped[0].reason).toBe('skipped-too-soon');
      });

      it('skipped-paid when the live balance dropped below warningMinBalance', async () => {
        prisma.balanceReminderConfig.findUnique.mockResolvedValue({ warningDelayDays: 3, warningMinBalance: 100, autoWarningsEnabled: false });
        const res: any = await preview([wcust({ financialBalance: 40 })], [statementLog(['c1'])]);
        expect(res.skipped[0].reason).toBe('skipped-paid');
      });

      it('skipped-payment-pending when a PaymentRequest is in flight', async () => {
        const res: any = await preview([wcust({ paymentRequests: [{ id: 'pr1' }] })], [statementLog(['c1'])]);
        expect(res.skipped[0].reason).toBe('skipped-payment-pending');
      });

      it('skipped-already-warned from a prior WARNING log', async () => {
        const res: any = await preview([wcust()], [statementLog(['c1'])], [warnLog(['c1'])]);
        expect(res.skipped[0].reason).toBe('skipped-already-warned');
      });

      it('skipped-already-warned from the redis month marker', async () => {
        (service as any).redis = makeRedis(['balance-warning-sent:v1:c1']);
        const res: any = await preview([wcust()], [statementLog(['c1'])]);
        expect(res.skipped[0].reason).toBe('skipped-already-warned');
      });

      it('skipped-new-customer when createdAt is on/after month end', async () => {
        const res: any = await preview([wcust({ createdAt: new Date('2026-09-05') })], [statementLog(['c1'])]);
        expect(res.skipped[0].reason).toBe('skipped-new-customer');
      });

      it('billing-exempt customers are filtered out by the query (where isBillingExempt:false)', async () => {
        setLogs([statementLog(['c1'])]);
        prisma.customer.findMany.mockResolvedValue([]); // simulate exempt filtered by DB
        const res: any = await service.previewReminders('v1', { sendKind: 'warning', mode: 'eligible', month: MONTH } as any);
        expect(prisma.customer.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: expect.objectContaining({ isBillingExempt: false, isActive: true }) }),
        );
        expect(res.totalWouldSend).toBe(0);
      });

      it('paymentType filter is pushed into the audience query (eligible mode)', async () => {
        setLogs([statementLog(['c1'])]);
        prisma.customer.findMany.mockResolvedValue([]);
        const res: any = await service.previewReminders(
          'v1',
          { sendKind: 'warning', mode: 'eligible', month: MONTH, paymentType: 'MONTHLY' } as any,
        );
        expect(prisma.customer.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: expect.objectContaining({ paymentType: 'MONTHLY' }) }),
        );
        expect(res.paymentType).toBe('MONTHLY');
      });

      it('van + dayOfWeek filter is pushed in via a deliverySchedules.some clause', async () => {
        setLogs([statementLog(['c1'])]);
        prisma.customer.findMany.mockResolvedValue([]);
        await service.previewReminders(
          'v1',
          { sendKind: 'warning', mode: 'eligible', month: MONTH, vanId: 'van-1', dayOfWeek: 3 } as any,
        );
        expect(prisma.customer.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ deliverySchedules: { some: { vanId: 'van-1', dayOfWeek: 3 } } }),
          }),
        );
      });

      it('audience filters are NOT applied in single/selected mode', async () => {
        setLogs([statementLog(['c1'])]);
        prisma.customer.findMany.mockResolvedValue([]);
        await service.previewReminders(
          'v1',
          { sendKind: 'warning', mode: 'selected', customerIds: ['c1'], month: MONTH, paymentType: 'MONTHLY', vanId: 'van-1' } as any,
        );
        const where = prisma.customer.findMany.mock.calls[0][0].where;
        expect(where).not.toHaveProperty('paymentType');
        expect(where).not.toHaveProperty('deliverySchedules');
      });
    });

    // ── send ────────────────────────────────────────────────────────────────

    describe('send', () => {
      const sendWarn = (customers: WCustomer[], dto: any = {}) => {
        setLogs([statementLog(customers.map((c) => c.id))]);
        prisma.customer.findMany.mockResolvedValue(customers);
        return service.sendTargeted('v1', { sendKind: 'warning', mode: 'eligible', month: MONTH, ...dto } as any);
      };

      it('sends payment_overdue_warning with the live balance, no PDF', async () => {
        const res: any = await sendWarn([wcust({ financialBalance: 1500 })]);
        expect(res.sent).toBe(1);
        expect(whatsapp.sendTemplate).toHaveBeenCalledWith(VALID_PHONE, 'payment_overdue_warning', ['Cust 1', '1500.00']);
        expect(whatsapp.sendTemplate).toHaveBeenCalledTimes(1);
      });

      it('on success sets BOTH the 23h cooldown key and the warning-month key', async () => {
        await sendWarn([wcust()]);
        const keys = redis.set.mock.calls.map((c) => c[0]);
        expect(keys).toEqual(expect.arrayContaining([
          expect.stringContaining('balance-reminder-cooldown:v1:c1'),
          'balance-warning-sent:v1:c1:2026-08',
        ]));
      });

      it('log row: kind WARNING, includeStatement false, minBalance = warningMinBalance', async () => {
        prisma.balanceReminderConfig.findUnique.mockResolvedValue({ warningDelayDays: 3, warningMinBalance: 250, autoWarningsEnabled: false });
        await sendWarn([wcust({ financialBalance: 900 })]);
        expect(prisma.reminderSendLog.create).toHaveBeenCalledWith({
          data: expect.objectContaining({ kind: 'WARNING', mode: 'eligible', includeStatement: false, minBalance: 250, trigger: 'manual' }),
        });
      });

      it('vendor PAYMENT_WARNING switch off → failed, nothing sent', async () => {
        notifSettings.isEnabled.mockResolvedValue(false);
        const res: any = await sendWarn([wcust()]);
        expect(res.customers[0].status).toBe('failed');
        expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
        expect(notifSettings.isEnabled).toHaveBeenCalledWith('v1', 'PAYMENT_WARNING', 'WHATSAPP');
      });

      it('dry run: would-send rows, no send, no log', async () => {
        const res: any = await sendWarn([wcust()], { dryRun: true });
        expect(res.customers[0].status).toBe('would-send');
        expect(res.sent).toBe(0);
        expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
        expect(prisma.reminderSendLog.create).not.toHaveBeenCalled();
      });

      it('single mode with empty customerIds → error envelope', async () => {
        const res: any = await service.sendTargeted('v1', { sendKind: 'warning', mode: 'single', customerIds: [] } as any);
        expect(res.error).toContain('customerIds is required');
      });

      it('processVendorReminders(kind=WARNING) delegates to the warning path (no all-customer scan)', async () => {
        const spy = jest.spyOn(service as any, 'resolveWarningAudience').mockResolvedValue([]);
        await service.processVendorReminders('v1', 100, false, MONTH, false, undefined, false, 'manual', undefined, undefined, undefined, 'WARNING' as any);
        expect(spy).toHaveBeenCalled();
      });
    });
  });

  // ═════════════════════════ Phase 3 — history kind filter ══════════════════

  describe('Phase 3 — getSendHistory kind filter', () => {
    const findWhere = () => prisma.reminderSendLog.findMany.mock.calls[0][0].where;

    it('adds where.kind when a kind filter is given', async () => {
      await service.getSendHistory('v1', 1, 10, { kind: 'WARNING' });
      expect(findWhere()).toEqual(expect.objectContaining({ vendorId: 'v1', kind: 'WARNING' }));
      expect(prisma.reminderSendLog.count).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ kind: 'WARNING' }) }));
    });

    it('omits where.kind when no kind filter is given (unchanged behaviour)', async () => {
      await service.getSendHistory('v1', 1, 10, { result: 'sent' });
      const where = findWhere();
      expect(where).not.toHaveProperty('kind');
      expect(where).toEqual(expect.objectContaining({ vendorId: 'v1', sent: { gt: 0 } }));
    });

    it('combines kind with the date + result filters', async () => {
      await service.getSendHistory('v1', 2, 8, { dateFrom: '2026-08-01', dateTo: '2026-08-31', result: 'skipped', kind: 'STATEMENT_ONLY' });
      const where = findWhere();
      expect(where.kind).toBe('STATEMENT_ONLY');
      expect(where.skipped).toEqual({ gt: 0 });
      expect(where.createdAt.gte).toBeInstanceOf(Date);
      expect(where.createdAt.lte).toBeInstanceOf(Date);
    });
  });
});
