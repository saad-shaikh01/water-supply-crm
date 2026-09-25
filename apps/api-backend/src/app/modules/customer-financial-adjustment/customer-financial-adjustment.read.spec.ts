import { NotFoundException } from '@nestjs/common';
import { CustomerFinancialAdjustmentService } from './customer-financial-adjustment.service';

const VENDOR_ID = 'vendor-1';
const CUSTOMER_ID = '3f1f6d3e-8b1a-4c1e-9d55-2f1c3e5a7b90';

function build(rows: any[] = [], total = rows.length) {
  const prisma = {
    customerFinancialAdjustment: {
      findMany: jest.fn().mockResolvedValue(rows),
      count: jest.fn().mockResolvedValue(total),
      findFirst: jest.fn(),
    },
  };
  const permissions = { can: jest.fn() };
  const service = new CustomerFinancialAdjustmentService(prisma as any, {} as any, permissions as any);
  return { service, prisma, permissions };
}

const findManyArgs = (p: ReturnType<typeof build>['prisma']) => p.customerFinancialAdjustment.findMany.mock.calls[0][0];

describe('CustomerFinancialAdjustmentService.list', () => {
  it('returns a page in the standard paginated shape and defaults to page 1 / 20 rows', async () => {
    const rows = [{ id: 'a1' }, { id: 'a2' }];
    const { service, prisma } = build(rows, 45);

    const result = await service.list(VENDOR_ID, {} as any);

    expect(result).toEqual({ data: rows, meta: { total: 45, page: 1, limit: 20, totalPages: 3 } });
    expect(findManyArgs(prisma)).toMatchObject({ skip: 0, take: 20 });
  });

  it('paginates: page 3 of 10 skips 20', async () => {
    const { service, prisma } = build([], 95);
    const result = await service.list(VENDOR_ID, { page: 3, limit: 10 } as any);
    expect(findManyArgs(prisma)).toMatchObject({ skip: 20, take: 10 });
    expect(result.meta).toEqual({ total: 95, page: 3, limit: 10, totalPages: 10 });
  });

  describe('tenancy and filters', () => {
    it('is ALWAYS scoped to the caller\'s vendor, and adds nothing else when no filter is given', async () => {
      const { service, prisma } = build();
      await service.list(VENDOR_ID, {} as any);
      expect(findManyArgs(prisma).where).toEqual({ vendorId: VENDOR_ID });
    });

    it('counts with the SAME where as the page, so totals match the filter', async () => {
      const { service, prisma } = build();
      await service.list(VENDOR_ID, { customerId: CUSTOMER_ID, status: 'VOIDED' } as any);
      expect(prisma.customerFinancialAdjustment.count).toHaveBeenCalledWith({ where: findManyArgs(prisma).where });
    });

    it('maps customerId, kind and status', async () => {
      const { service, prisma } = build();
      await service.list(VENDOR_ID, { customerId: CUSTOMER_ID, kind: 'REVERSAL', status: 'POSTED' } as any);
      expect(findManyArgs(prisma).where).toEqual({
        vendorId: VENDOR_ID,
        customerId: CUSTOMER_ID,
        kind: 'REVERSAL',
        status: 'POSTED',
      });
    });

    it('filters the business date by the VENDOR\'s calendar day (Asia/Karachi), inclusive both ends', async () => {
      const { service, prisma } = build();
      await service.list(VENDOR_ID, { dateFrom: '2026-09-05', dateTo: '2026-09-10' } as any);
      const { effectiveDate } = findManyArgs(prisma).where;
      // PKT midnight of Sept 5 = Sept 4 19:00 UTC; the last ms of PKT Sept 10 = Sept 10 18:59:59.999 UTC.
      expect(effectiveDate.gte).toEqual(new Date('2026-09-04T19:00:00.000Z'));
      expect(effectiveDate.lte).toEqual(new Date('2026-09-10T18:59:59.999Z'));
    });

    it.each([
      ['only dateFrom', { dateFrom: '2026-09-05' }, ['gte']],
      ['only dateTo', { dateTo: '2026-09-10' }, ['lte']],
    ])('supports %s (open-ended range)', async (_label, query, keys) => {
      const { service, prisma } = build();
      await service.list(VENDOR_ID, query as any);
      expect(Object.keys(findManyArgs(prisma).where.effectiveDate)).toEqual(keys);
    });

    it('a request with no date filter adds no effectiveDate condition at all', async () => {
      const { service, prisma } = build();
      await service.list(VENDOR_ID, { kind: 'PENALTY' } as any);
      expect('effectiveDate' in findManyArgs(prisma).where).toBe(false);
    });
  });

  describe('shape of each row', () => {
    it('newest business date first; same-day entries keep their posting order', async () => {
      const { service, prisma } = build();
      await service.list(VENDOR_ID, {} as any);
      expect(findManyArgs(prisma).orderBy).toEqual([{ effectiveDate: 'desc' }, { createdAt: 'desc' }]);
    });

    it('includes the customer, who created/voided it, BOTH ends of the void chain, and the ledger row', async () => {
      const { service, prisma } = build();
      await service.list(VENDOR_ID, {} as any);
      const { include, select } = findManyArgs(prisma);
      expect(Object.keys(include).sort()).toEqual(
        ['causedByStaffLedgerEntry', 'createdBy', 'customer', 'reversalOf', 'reversedBy', 'transaction', 'voidedBy'],
      );
      // `include` (not a root `select`) means EVERY scalar is returned — including the
      // staff-only internalNote this endpoint is permission-gated to show.
      expect(select).toBeUndefined();
    });

    it('the chain and ledger selections expose what the UI needs, and only that', async () => {
      const { service, prisma } = build();
      await service.list(VENDOR_ID, {} as any);
      const { include } = findManyArgs(prisma);
      expect(Object.keys(include.reversalOf.select).sort()).toEqual(['effectiveDate', 'id', 'kind', 'status', 'title']);
      expect(Object.keys(include.reversedBy.select).sort()).toEqual(['effectiveDate', 'id', 'kind', 'status']);
      expect(Object.keys(include.transaction.select).sort()).toEqual(['amount', 'createdAt', 'description', 'id']);
      // No password / email leaks through the user relations.
      expect(Object.keys(include.createdBy.select).sort()).toEqual(['id', 'name']);
      expect(Object.keys(include.voidedBy.select).sort()).toEqual(['id', 'name']);
    });
  });

  it('is a pure read: no permission lookup in the service (the route guard owns `view`)', async () => {
    const { service, permissions } = build();
    await service.list(VENDOR_ID, {} as any);
    expect(permissions.can).not.toHaveBeenCalled();
  });
});

describe('CustomerFinancialAdjustmentService.get', () => {
  it('returns the adjustment with its chain and ledger row', async () => {
    const row = { id: 'adj-1', status: 'VOIDED', reversedBy: { id: 'adj-2', kind: 'REVERSAL' }, transaction: { amount: 500 } };
    const { service, prisma } = build();
    prisma.customerFinancialAdjustment.findFirst.mockResolvedValue(row);

    await expect(service.get(VENDOR_ID, 'adj-1')).resolves.toBe(row);
    const args = prisma.customerFinancialAdjustment.findFirst.mock.calls[0][0];
    expect(Object.keys(args.include).sort()).toEqual(
      ['causedByStaffLedgerEntry', 'createdBy', 'customer', 'reversalOf', 'reversedBy', 'transaction', 'voidedBy'],
    );
  });

  it('is scoped to the caller\'s vendor — another vendor\'s id is a 404, not a leak', async () => {
    const { service, prisma } = build();
    prisma.customerFinancialAdjustment.findFirst.mockResolvedValue(null); // what the DB returns for a foreign id

    await expect(service.get(VENDOR_ID, 'adj-of-another-vendor')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.customerFinancialAdjustment.findFirst.mock.calls[0][0].where).toEqual({
      id: 'adj-of-another-vendor',
      vendorId: VENDOR_ID,
    });
  });

  it('404s for an unknown id', async () => {
    const { service, prisma } = build();
    prisma.customerFinancialAdjustment.findFirst.mockResolvedValue(null);
    await expect(service.get(VENDOR_ID, 'nope')).rejects.toThrow('Adjustment not found');
  });
});
