import { BadRequestException, ConflictException } from '@nestjs/common';
import { CustomerGroupService } from './customer-group.service';
import { resolveCustomerGrouping } from './customer-group.helper';

const V = 'vendor-1';

function makeDb(opts: { enabled?: boolean; groups?: Array<{ id: string; parentId: string | null; deletedAt?: Date | null }> } = {}) {
  const groups = opts.groups ?? [];
  return {
    vendor: { findUnique: jest.fn().mockResolvedValue({ customerGroupingEnabled: opts.enabled ?? true }) },
    customerGroup: {
      findFirst: jest.fn(async ({ where }: any) =>
        groups.find(
          (g) =>
            g.id === where.id &&
            (where.parentId === undefined || g.parentId === where.parentId) &&
            !g.deletedAt,
        ) ?? null,
      ),
    },
  } as any;
}

describe('resolveCustomerGrouping', () => {
  it('returns nulls without touching the DB when nothing is set (works with grouping off)', async () => {
    const db = makeDb({ enabled: false });
    await expect(resolveCustomerGrouping(db, V, null, undefined)).resolves.toEqual({ groupId: null, subGroupId: null });
    expect(db.vendor.findUnique).not.toHaveBeenCalled();
  });

  it('rejects any group when the vendor has grouping disabled', async () => {
    const db = makeDb({ enabled: false });
    await expect(resolveCustomerGrouping(db, V, 'g1', null)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a sub-group without a group', async () => {
    await expect(resolveCustomerGrouping(makeDb(), V, null, 's1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a group alone, and a sub-group under its own group', async () => {
    const db = makeDb({ groups: [{ id: 'g1', parentId: null }, { id: 's1', parentId: 'g1' }] });
    await expect(resolveCustomerGrouping(db, V, 'g1', null)).resolves.toEqual({ groupId: 'g1', subGroupId: null });
    await expect(resolveCustomerGrouping(db, V, 'g1', 's1')).resolves.toEqual({ groupId: 'g1', subGroupId: 's1' });
  });

  it('rejects a sub-group that belongs to a different group', async () => {
    const db = makeDb({ groups: [{ id: 'g1', parentId: null }, { id: 'g2', parentId: null }, { id: 's2', parentId: 'g2' }] });
    await expect(resolveCustomerGrouping(db, V, 'g1', 's2')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a soft-deleted group', async () => {
    const db = makeDb({ groups: [{ id: 'g1', parentId: null, deletedAt: new Date() }] });
    await expect(resolveCustomerGrouping(db, V, 'g1', null)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('CustomerGroupService.remove', () => {
  const build = (assigned: number, group: { id: string; parentId: string | null }) => {
    const prisma = {
      customerGroup: {
        findFirst: jest.fn().mockResolvedValue(group),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      customer: { count: jest.fn().mockResolvedValue(assigned) },
    } as any;
    const audit = { log: jest.fn() } as any;
    const cache = { invalidateVendorEntity: jest.fn() } as any;
    return { prisma, service: new CustomerGroupService(prisma, cache, audit) };
  };

  it('blocks deletion while customers are assigned', async () => {
    const { prisma, service } = build(3, { id: 'g1', parentId: null });
    await expect(service.remove(V, 'g1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.customerGroup.updateMany).not.toHaveBeenCalled();
  });

  it('soft-deletes an empty group together with its sub-groups', async () => {
    const { prisma, service } = build(0, { id: 'g1', parentId: null });
    await service.remove(V, 'g1');
    const arg = prisma.customerGroup.updateMany.mock.calls[0][0];
    expect(arg.data.deletedAt).toBeInstanceOf(Date);
    expect(arg.where.OR).toEqual([{ id: 'g1' }, { parentId: 'g1' }]);
  });

  it('counts a sub-group by subGroupId, a group by groupId', async () => {
    const sub = build(0, { id: 's1', parentId: 'g1' });
    await sub.service.remove(V, 's1');
    expect(sub.prisma.customer.count).toHaveBeenCalledWith({ where: { vendorId: V, subGroupId: 's1' } });
    const grp = build(0, { id: 'g1', parentId: null });
    await grp.service.remove(V, 'g1');
    expect(grp.prisma.customer.count).toHaveBeenCalledWith({ where: { vendorId: V, groupId: 'g1' } });
  });
});
