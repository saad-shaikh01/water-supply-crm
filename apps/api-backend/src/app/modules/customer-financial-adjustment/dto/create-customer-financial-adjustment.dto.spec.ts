import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCustomerFinancialAdjustmentDto } from './create-customer-financial-adjustment.dto';

const valid = () => ({
  customerId: '3f1f6d3e-8b1a-4c1e-9d55-2f1c3e5a7b90',
  kind: 'PENALTY',
  amount: 500,
  title: 'Late payment penalty',
  idempotencyKey: 'dialog-open-uuid-1',
});

async function errorsFor(over: Record<string, unknown> = {}) {
  const dto = plainToInstance(CreateCustomerFinancialAdjustmentDto, { ...valid(), ...over });
  const errors = await validate(dto);
  return { dto, fields: errors.map((e) => e.property).sort() };
}

describe('CreateCustomerFinancialAdjustmentDto', () => {
  it('accepts a minimal valid request', async () => {
    expect((await errorsFor()).fields).toEqual([]);
  });

  it.each(['SERVICE_FEE', 'PENALTY', 'OTHER_CHARGE', 'DISCOUNT', 'GOODWILL_CREDIT', 'OTHER_CREDIT'])(
    'accepts kind %s',
    async (kind) => {
      expect((await errorsFor({ kind })).fields).toEqual([]);
    },
  );

  it.each(['WRITE_OFF', 'CORRECTION', 'TRANSFER_OUT', 'TRANSFER_IN', 'REVERSAL', 'penalty', ''])(
    'rejects kind %p (not enabled in this slice)',
    async (kind) => {
      expect((await errorsFor({ kind })).fields).toEqual(['kind']);
    },
  );

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['3 decimal places', 10.005],
    ['a string', '500'],
    ['NaN', NaN],
  ])('rejects an amount that is %s', async (_label, amount) => {
    expect((await errorsFor({ amount })).fields).toContain('amount');
  });

  it('accepts 2-decimal amounts', async () => {
    expect((await errorsFor({ amount: 1234.56 })).fields).toEqual([]);
  });

  it('requires an idempotency key (8–100 chars)', async () => {
    expect((await errorsFor({ idempotencyKey: undefined })).fields).toEqual(['idempotencyKey']);
    expect((await errorsFor({ idempotencyKey: 'short' })).fields).toEqual(['idempotencyKey']);
    expect((await errorsFor({ idempotencyKey: 'x'.repeat(101) })).fields).toEqual(['idempotencyKey']);
  });

  it('requires a non-blank title and trims it', async () => {
    expect((await errorsFor({ title: '   ' })).fields).toEqual(['title']);
    expect((await errorsFor({ title: 'x'.repeat(121) })).fields).toEqual(['title']);
    const { dto, fields } = await errorsFor({ title: '  Installation fee  ' });
    expect(fields).toEqual([]);
    expect(dto.title).toBe('Installation fee');
  });

  it('requires a UUID customerId (same as the other ledger DTOs)', async () => {
    expect((await errorsFor({ customerId: 'not-a-uuid' })).fields).toEqual(['customerId']);
  });

  it('validates the optional fields when present', async () => {
    expect((await errorsFor({ internalNote: 'x'.repeat(1001) })).fields).toEqual(['internalNote']);
    expect((await errorsFor({ referenceNo: 'x'.repeat(121) })).fields).toEqual(['referenceNo']);
    expect((await errorsFor({ effectiveDate: 'yesterday' })).fields).toEqual(['effectiveDate']);
    expect((await errorsFor({ effectiveDate: '2026-09-05', internalNote: 'why', referenceNo: 'R-1' })).fields).toEqual([]);
  });
});
