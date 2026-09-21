import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  VOID_REASON_MIN_LENGTH,
  VoidCustomerFinancialAdjustmentDto,
} from './void-customer-financial-adjustment.dto';

async function check(body: Record<string, unknown>) {
  const dto = plainToInstance(VoidCustomerFinancialAdjustmentDto, body);
  const errors = await validate(dto);
  return { dto, fields: errors.map((e) => e.property) };
}

describe('VoidCustomerFinancialAdjustmentDto', () => {
  it('accepts a proper reason', async () => {
    expect((await check({ reason: 'Entered against the wrong customer' })).fields).toEqual([]);
  });

  it('trims the reason', async () => {
    const { dto, fields } = await check({ reason: '   Duplicate entry   ' });
    expect(fields).toEqual([]);
    expect(dto.reason).toBe('Duplicate entry');
  });

  it('requires a reason', async () => {
    expect((await check({})).fields).toEqual(['reason']);
    expect((await check({ reason: '' })).fields).toEqual(['reason']);
    expect((await check({ reason: '      ' })).fields).toEqual(['reason']); // trims to empty
  });

  it(`requires at least ${VOID_REASON_MIN_LENGTH} characters (after trimming)`, async () => {
    expect((await check({ reason: 'x'.repeat(VOID_REASON_MIN_LENGTH - 1) })).fields).toEqual(['reason']);
    expect((await check({ reason: 'x'.repeat(VOID_REASON_MIN_LENGTH) })).fields).toEqual([]);
    expect((await check({ reason: `  ${'x'.repeat(VOID_REASON_MIN_LENGTH - 1)}  ` })).fields).toEqual(['reason']);
  });

  it('caps the reason at 500 characters', async () => {
    expect((await check({ reason: 'x'.repeat(500) })).fields).toEqual([]);
    expect((await check({ reason: 'x'.repeat(501) })).fields).toEqual(['reason']);
  });

  it('rejects a non-string reason', async () => {
    expect((await check({ reason: 12345 })).fields).toContain('reason');
    expect((await check({ reason: null })).fields).toContain('reason');
  });
});
