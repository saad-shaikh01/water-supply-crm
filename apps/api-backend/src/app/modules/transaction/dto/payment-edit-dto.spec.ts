import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PaymentEditReason } from '@prisma/client';
import { EditPaymentDto } from './edit-payment.dto';
import { DeletePaymentDto } from './delete-payment.dto';

const VALID_DATE = '2026-08-27T10:00:00.000Z';

const props = (errs: Awaited<ReturnType<typeof validate>>) =>
  errs.map((e) => e.property);

describe('EditPaymentDto validation', () => {
  it('accepts a well-formed payload', async () => {
    const dto = plainToInstance(EditPaymentDto, {
      amount: 1500,
      description: 'cash recounted at depot',
      reason: PaymentEditReason.WRONG_AMOUNT,
      expectedUpdatedAt: VALID_DATE,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects amount: 0 (below Min 0.01)', async () => {
    const dto = plainToInstance(EditPaymentDto, {
      amount: 0,
      reason: PaymentEditReason.WRONG_AMOUNT,
      expectedUpdatedAt: VALID_DATE,
    });
    expect(props(await validate(dto))).toContain('amount');
  });

  it('rejects a negative amount', async () => {
    const dto = plainToInstance(EditPaymentDto, {
      amount: -5,
      reason: PaymentEditReason.WRONG_AMOUNT,
      expectedUpdatedAt: VALID_DATE,
    });
    expect(props(await validate(dto))).toContain('amount');
  });

  it('accepts a large amount — there is no upper bound (overpayment ⇒ credit)', async () => {
    const dto = plainToInstance(EditPaymentDto, {
      amount: 9_999_999,
      reason: PaymentEditReason.WRONG_AMOUNT,
      expectedUpdatedAt: VALID_DATE,
    });
    expect(props(await validate(dto))).not.toContain('amount');
  });

  it('rejects reason OTHER without a reasonNote', async () => {
    const dto = plainToInstance(EditPaymentDto, {
      amount: 1500,
      reason: PaymentEditReason.OTHER,
      expectedUpdatedAt: VALID_DATE,
    });
    expect(props(await validate(dto))).toContain('reasonNote');
  });

  it('rejects reason OTHER with a too-short reasonNote', async () => {
    const dto = plainToInstance(EditPaymentDto, {
      amount: 1500,
      reason: PaymentEditReason.OTHER,
      reasonNote: 'ab',
      expectedUpdatedAt: VALID_DATE,
    });
    expect(props(await validate(dto))).toContain('reasonNote');
  });

  it('accepts reason OTHER with a valid reasonNote', async () => {
    const dto = plainToInstance(EditPaymentDto, {
      amount: 1500,
      reason: PaymentEditReason.OTHER,
      reasonNote: 'manager approved after review',
      expectedUpdatedAt: VALID_DATE,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts a non-OTHER reason with no reasonNote', async () => {
    const dto = plainToInstance(EditPaymentDto, {
      amount: 1500,
      reason: PaymentEditReason.WRONG_AMOUNT,
      expectedUpdatedAt: VALID_DATE,
    });
    expect(props(await validate(dto))).not.toContain('reasonNote');
  });

  it('rejects a non-ISO expectedUpdatedAt', async () => {
    const dto = plainToInstance(EditPaymentDto, {
      amount: 1500,
      reason: PaymentEditReason.WRONG_AMOUNT,
      expectedUpdatedAt: 'not-a-date',
    });
    expect(props(await validate(dto))).toContain('expectedUpdatedAt');
  });

  it('accepts an ISO expectedUpdatedAt with milliseconds', async () => {
    const dto = plainToInstance(EditPaymentDto, {
      amount: 1500,
      reason: PaymentEditReason.WRONG_AMOUNT,
      expectedUpdatedAt: '2026-08-27T10:00:00.123Z',
    });
    expect(props(await validate(dto))).not.toContain('expectedUpdatedAt');
  });
});

describe('DeletePaymentDto validation', () => {
  it('accepts a well-formed payload', async () => {
    const dto = plainToInstance(DeletePaymentDto, {
      reason: PaymentEditReason.CASH_RECOUNTED,
      expectedUpdatedAt: VALID_DATE,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a missing reason', async () => {
    const dto = plainToInstance(DeletePaymentDto, {
      expectedUpdatedAt: VALID_DATE,
    });
    expect(props(await validate(dto))).toContain('reason');
  });

  it('rejects reason OTHER without a reasonNote', async () => {
    const dto = plainToInstance(DeletePaymentDto, {
      reason: PaymentEditReason.OTHER,
      expectedUpdatedAt: VALID_DATE,
    });
    expect(props(await validate(dto))).toContain('reasonNote');
  });

  it('rejects reason OTHER with a too-short reasonNote', async () => {
    const dto = plainToInstance(DeletePaymentDto, {
      reason: PaymentEditReason.OTHER,
      reasonNote: 'ab',
      expectedUpdatedAt: VALID_DATE,
    });
    expect(props(await validate(dto))).toContain('reasonNote');
  });

  it('accepts a non-OTHER reason with no reasonNote', async () => {
    const dto = plainToInstance(DeletePaymentDto, {
      reason: PaymentEditReason.DUPLICATE_ENTRY,
      expectedUpdatedAt: VALID_DATE,
    });
    expect(props(await validate(dto))).not.toContain('reasonNote');
  });

  it('rejects a non-ISO expectedUpdatedAt', async () => {
    const dto = plainToInstance(DeletePaymentDto, {
      reason: PaymentEditReason.DUPLICATE_ENTRY,
      expectedUpdatedAt: 'not-a-date',
    });
    expect(props(await validate(dto))).toContain('expectedUpdatedAt');
  });
});
