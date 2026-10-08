import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { PrismaService } from '@water-supply-crm/database';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import { TransactionType } from '@prisma/client';
import { NotificationService } from '../notifications/notification.service';
import { AuditService } from '../audit/audit.service';
import { CloudTemplateNames } from '../whatsapp/templates/cloud-template-names';
import type { AuthUser } from '@water-supply-crm/types';

const VENDOR_ID = 'vendor-1';
const TX_ID = 'tx-pay-1';
const USER = { userId: 'user-1', name: 'Cashier Bob', vendorId: VENDOR_ID } as AuthUser;

function makeTx(overrides: Record<string, unknown> = {}) {
  return {
    id: TX_ID,
    vendorId: VENDOR_ID,
    customerId: 'customer-1',
    type: TransactionType.PAYMENT,
    amount: -2500,
    dailySheetId: null,
    dailySheetItemId: null,
    paymentRequestId: null,
    customer: {
      id: 'customer-1',
      name: 'Ahmed',
      customerCode: 'C-001',
      phoneNumber: '923001234567',
      financialBalance: 1500,
    },
    ...overrides,
  };
}

describe('LedgerService — resendPaymentNotification', () => {
  let service: LedgerService;
  let findFirst: jest.Mock;
  let queueWhatsAppTemplate: jest.Mock;
  let auditLog: jest.Mock;

  beforeEach(async () => {
    findFirst = jest.fn();
    queueWhatsAppTemplate = jest.fn().mockResolvedValue({ id: 'job-1' });
    auditLog = jest.fn().mockResolvedValue(undefined);
    const module = await Test.createTestingModule({
      providers: [
        LedgerService,
        { provide: PrismaService, useValue: { transaction: { findFirst } } },
        { provide: CacheInvalidationService, useValue: {} },
        { provide: NotificationService, useValue: { queueWhatsAppTemplate } },
        { provide: AuditService, useValue: { log: auditLog } },
      ],
    }).compile();
    service = module.get(LedgerService);
  });

  it('re-sends the payment_recorded template with the same params as the original send', async () => {
    findFirst.mockResolvedValue(makeTx());

    const result = await service.resendPaymentNotification(VENDOR_ID, TX_ID, USER);

    expect(result).toEqual({ queued: true });
    const [phone, template, params, jobId, meta] = queueWhatsAppTemplate.mock.calls[0];
    expect(phone).toBe('923001234567');
    expect(template).toBe(CloudTemplateNames.PAYMENT_RECORDED);
    expect(params).toEqual(['Ahmed', 'C-001', '2500', '1500.00']);
    // Must not reuse the original send's job id, or BullMQ would dedupe it.
    expect(jobId).toMatch(/^ntf-payment-resend-tx-pay-1-\d+-wa$/);
    expect(jobId).not.toBe(`ntf-payment-recorded-${TX_ID}-wa`);
    expect(meta).toMatchObject({ vendorId: VENDOR_ID, recipientId: 'customer-1' });
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'RESEND_RECEIPT', entity: 'Transaction', entityId: TX_ID }),
    );
  });

  it('reports queued:false when notifications are disabled for the customer', async () => {
    findFirst.mockResolvedValue(makeTx());
    queueWhatsAppTemplate.mockResolvedValue(null);
    await expect(service.resendPaymentNotification(VENDOR_ID, TX_ID, USER)).resolves.toEqual({ queued: false });
  });

  it('404s for an unknown transaction', async () => {
    findFirst.mockResolvedValue(null);
    await expect(service.resendPaymentNotification(VENDOR_ID, TX_ID, USER)).rejects.toThrow(NotFoundException);
  });

  it.each([
    ['non-payment', { type: TransactionType.DELIVERY }],
    ['delivery-linked', { dailySheetItemId: 'item-1' }],
    ['portal-request', { paymentRequestId: 'pr-1' }],
  ])('rejects a %s transaction', async (_label, overrides) => {
    findFirst.mockResolvedValue(makeTx(overrides));
    await expect(service.resendPaymentNotification(VENDOR_ID, TX_ID, USER)).rejects.toThrow(ConflictException);
    expect(queueWhatsAppTemplate).not.toHaveBeenCalled();
  });

  it('rejects when the customer has no phone number', async () => {
    findFirst.mockResolvedValue(makeTx({ customer: { ...makeTx().customer, phoneNumber: null } }));
    await expect(service.resendPaymentNotification(VENDOR_ID, TX_ID, USER)).rejects.toThrow(BadRequestException);
  });
});
