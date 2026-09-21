import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ADJUSTMENT_KINDS, ADJUSTMENT_STATUSES } from '@water-supply-crm/types';
import { ListCustomerFinancialAdjustmentsQueryDto } from './list-customer-financial-adjustments-query.dto';

const UUID = '3f1f6d3e-8b1a-4c1e-9d55-2f1c3e5a7b90';

async function check(query: Record<string, unknown>) {
  const dto = plainToInstance(ListCustomerFinancialAdjustmentsQueryDto, query, { enableImplicitConversion: true });
  const errors = await validate(dto);
  return { dto, fields: errors.map((e) => e.property).sort() };
}

describe('ListCustomerFinancialAdjustmentsQueryDto', () => {
  it('accepts an empty query (all filters optional) with the standard paging defaults', async () => {
    const { dto, fields } = await check({});
    expect(fields).toEqual([]);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
  });

  it('accepts a fully populated query', async () => {
    const { fields } = await check({
      customerId: UUID, kind: 'PENALTY', status: 'POSTED', dateFrom: '2026-09-01', dateTo: '2026-09-30', page: '2', limit: '50',
    });
    expect(fields).toEqual([]);
  });

  it.each([...ADJUSTMENT_KINDS])('accepts kind %s — a LIST must be able to show reversals and transfer legs too', async (kind) => {
    expect((await check({ kind })).fields).toEqual([]);
  });

  it('rejects an unknown kind', async () => {
    expect((await check({ kind: 'BONUS' })).fields).toEqual(['kind']);
  });

  it.each([...ADJUSTMENT_STATUSES])('accepts status %s', async (status) => {
    expect((await check({ status })).fields).toEqual([]);
  });

  it.each(['PENDING', 'posted', ''])('rejects status %p', async (status) => {
    expect((await check({ status })).fields).toEqual(['status']);
  });

  it('requires customerId to be a UUID', async () => {
    expect((await check({ customerId: 'not-a-uuid' })).fields).toEqual(['customerId']);
  });

  it('requires valid dates', async () => {
    expect((await check({ dateFrom: 'yesterday' })).fields).toEqual(['dateFrom']);
    expect((await check({ dateTo: '31/09/2026' })).fields).toEqual(['dateTo']);
  });

  it('inherits the paging bounds: page >= 1, 1 <= limit <= 100', async () => {
    expect((await check({ page: 0 })).fields).toEqual(['page']);
    expect((await check({ limit: 0 })).fields).toEqual(['limit']);
    expect((await check({ limit: 101 })).fields).toEqual(['limit']);
    expect((await check({ limit: 100 })).fields).toEqual([]);
  });
});
