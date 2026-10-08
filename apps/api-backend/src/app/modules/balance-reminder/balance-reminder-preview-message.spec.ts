import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { BalanceReminderService } from './balance-reminder.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { NotificationSettingsService } from '../notifications/notification-settings.service';
import { CustomerStatementPdfService } from '../customer/pdf/customer-statement-pdf.service';
import { buildReminderMessage } from './reminder-message.builder';
import { renderTemplateBody } from './reminder-template-bodies';

const VALID_PHONE = '+923001234567';
const MONTH = '2026-09';

const customerRow = (over: Record<string, unknown> = {}) => ({
  id: 'c1', name: 'Ms.Farah', customerCode: 'L3820', phoneNumber: VALID_PHONE,
  financialBalance: 1540, isActive: true, paymentType: 'CASH', createdAt: new Date('2020-01-01'), ...over,
});

describe('reminder-message builder + renderer', () => {
  it.each([
    [{ balance: 500, withDocument: true }, 'monthly_statement', ['Ahmed', 'L1', '500.00']],
    [{ balance: -300, withDocument: true }, 'monthly_statement_advance', ['Ahmed', 'September 2026', '300.00']],
    [{ balance: 0, withDocument: true }, 'monthly_statement_clear', ['Ahmed', 'September 2026']],
    [{ balance: 500, withDocument: false }, 'balance_reminder', ['Ahmed', '500.00']],
    [{ balance: -300, withDocument: false }, 'balance_clear_advance', ['Ahmed', '300.00']],
    [{ balance: 0, withDocument: false }, 'balance_clear', ['Ahmed']],
  ])('reminder %j → %s', (opts, template, params) => {
    const m = buildReminderMessage({ name: 'Ahmed', customerCode: 'L1', monthLabel: 'September 2026', ...opts });
    expect(m).toEqual({ templateName: template, params, withDocument: opts.withDocument });
  });

  it('fills {{n}} placeholders and returns null for an unknown template', () => {
    expect(renderTemplateBody('balance_reminder', ['Ahmed', '500.00'])).toContain('outstanding balance of Rs. 500.00');
    expect(renderTemplateBody('no_such_template', [])).toBeNull();
  });
});

describe('BalanceReminderService.previewMessage', () => {
  let service: BalanceReminderService;
  let prisma: any;
  let whatsapp: { sendTemplate: jest.Mock; isReady: jest.Mock };
  let notifSettings: { isEnabled: jest.Mock };

  beforeEach(async () => {
    prisma = {
      customer: { findMany: jest.fn(), findFirst: jest.fn() },
      transaction: { findMany: jest.fn().mockResolvedValue([]), groupBy: jest.fn().mockResolvedValue([]) },
      reminderSendLog: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]), count: jest.fn() },
      balanceReminderConfig: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    whatsapp = { sendTemplate: jest.fn().mockResolvedValue(true), isReady: jest.fn().mockReturnValue(true) };
    notifSettings = { isEnabled: jest.fn().mockResolvedValue(true) };
    const module = await Test.createTestingModule({
      providers: [
        BalanceReminderService,
        { provide: PrismaService, useValue: prisma },
        { provide: WhatsAppService, useValue: whatsapp },
        { provide: NotificationSettingsService, useValue: notifSettings },
        { provide: CustomerStatementPdfService, useValue: { generate: jest.fn() } },
      ],
    }).compile();
    service = module.get(BalanceReminderService);
    const chain: any = { exists: () => chain, exec: () => Promise.resolve([]) };
    jest.spyOn(service as any, 'sendDelay').mockResolvedValue(undefined);
    (service as any).redis = { exists: jest.fn(), set: jest.fn(), pipeline: () => chain };
  });

  it('warning for a CASH customer shows the live balance as invoice/outstanding (rendered text)', async () => {
    prisma.customer.findMany.mockResolvedValue([{ ...customerRow(), paymentRequests: [] }]);
    prisma.transaction.findMany.mockResolvedValue([{ type: 'DELIVERY', amount: 1540 }]);

    const res = await service.previewMessage('v1', { customerId: 'c1', sendKind: 'warning', month: MONTH });

    expect(res.templateName).toBe('payment_overdue_warning');
    expect(res.params).toEqual(['Ms.Farah', 'L3820', '1540.00', '1540.00', '0.00', '1540.00']);
    expect(res.text).toContain('Invoice Amount: Rs. *1540.00*');
    expect(res.attachment).toEqual({ filename: 'L3820_Ms_Farah_September_2026.pdf' });
    expect(res.notes).toEqual([]);
  });

  it('reminder preview == what the real send passes to WhatsApp (same template + params)', async () => {
    prisma.customer.findMany.mockResolvedValue([customerRow({ paymentType: 'MONTHLY' })]);
    const preview = await service.previewMessage('v1', { customerId: 'c1', sendKind: 'reminder', month: MONTH, includeStatement: false });

    prisma.customer.findMany.mockResolvedValue([customerRow({ paymentType: 'MONTHLY' })]);
    await service.sendTargeted('v1', { sendKind: 'reminder', mode: 'single', customerIds: ['c1'], month: MONTH, includeStatement: false } as any);

    expect(whatsapp.sendTemplate).toHaveBeenCalledWith(VALID_PHONE, preview.templateName, preview.params);
    expect(preview.attachment).toBeNull();
  });

  it('statement-only always attaches the PDF with the neutral template', async () => {
    prisma.customer.findMany.mockResolvedValue([customerRow()]);
    const res = await service.previewMessage('v1', { customerId: 'c1', sendKind: 'statement_only', month: MONTH });
    expect(res.templateName).toBe('monthly_statement_neutral');
    expect(res.params).toEqual(['Ms.Farah', 'September 2026']);
    expect(res.attachment).not.toBeNull();
  });

  it('is read-only: sends nothing and writes no log', async () => {
    prisma.customer.findMany.mockResolvedValue([customerRow()]);
    await service.previewMessage('v1', { customerId: 'c1', sendKind: 'reminder', month: MONTH });
    expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
    expect(prisma.reminderSendLog.create).not.toHaveBeenCalled();
  });

  it('flags a switched-off message type and an invalid phone number', async () => {
    notifSettings.isEnabled.mockResolvedValue(false);
    prisma.customer.findMany.mockResolvedValue([customerRow({ phoneNumber: '-' })]);
    const res = await service.previewMessage('v1', { customerId: 'c1', sendKind: 'reminder', month: MONTH });
    expect(res.notes.join(' ')).toMatch(/switched OFF/);
    expect(res.notes.join(' ')).toMatch(/not valid for WhatsApp/);
  });

  it('404s when the customer is not found', async () => {
    prisma.customer.findMany.mockResolvedValue([]);
    await expect(service.previewMessage('v1', { customerId: 'nope', sendKind: 'reminder' })).rejects.toThrow(NotFoundException);
  });
});
