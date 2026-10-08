import { ImportExecutorService } from './import-executor.service';

const executeRow = jest.fn();
jest.mock('./definitions/registry', () => ({
  getDefinition: () => ({ prepareExecution: async () => ({}), executeRow: (...a: unknown[]) => executeRow(...a) }),
}));

function build() {
  const rowUpdates: { where: Record<string, unknown>; data: Record<string, unknown> }[] = [];
  const prisma = {
    importBatch: {
      findFirst: jest.fn(async () => ({ id: 'b1', entity: 'CUSTOMERS_OPENING', startedAt: null, options: {}, summary: { plan: { create: 1 } } })),
      updateMany: jest.fn(async () => ({ count: 1 })),
      update: jest.fn(async () => ({})),
    },
    importRow: {
      findMany: jest.fn(async () => [{ id: 'r1', rowNumber: 2, normalized: { name: 'A' } }]),
      groupBy: jest.fn(async () => [{ result: 'CREATED', _count: 1 }]),
      update: jest.fn(),
      updateMany: jest.fn(async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        rowUpdates.push(a);
        return { count: 0 }; // the row was already CREATED in its own committed transaction
      }),
    },
  };
  const imports = { invalidateVendorCaches: jest.fn(async () => undefined) };
  const audit = { log: jest.fn(async () => undefined) };
  const svc = new ImportExecutorService(prisma as never, audit as never, imports as never);
  return { svc, prisma, rowUpdates, imports };
}

describe('ImportExecutorService.run', () => {
  beforeEach(() => executeRow.mockReset());

  it('never overwrites a row that already committed as CREATED when the client saw a failure (tx timeout after commit)', async () => {
    executeRow.mockResolvedValue({ result: 'FAILED', resultCode: 'DB_ERROR', resultMessage: 'x', cause: Object.assign(new Error('Transaction already closed'), { code: 'P2028' }) });
    const { svc, rowUpdates, prisma } = build();
    await svc.run({ batchId: 'b1', vendorId: 'v1' });

    // The FAILED write is guarded: it can only touch rows still PENDING/FAILED, so a committed CREATED survives.
    expect(rowUpdates).toHaveLength(1);
    expect(rowUpdates[0].where).toEqual({ id: 'r1', result: { in: ['PENDING', 'FAILED'] } });
    expect(rowUpdates[0].data).not.toHaveProperty('entityId'); // never nulls out the link to the created customer
    expect(prisma.importRow.update).not.toHaveBeenCalled(); // unguarded update path is not used for failures
  });

  it('a successful row is persisted only by the definition (inside its own transaction), not by the executor', async () => {
    executeRow.mockResolvedValue({ result: 'CREATED', entityId: 'c1', entityType: 'Customer' });
    const { svc, rowUpdates, imports } = build();
    await svc.run({ batchId: 'b1', vendorId: 'v1' });
    expect(rowUpdates).toHaveLength(0);
    expect(imports.invalidateVendorCaches).toHaveBeenCalledWith('v1');
  });

  it('does nothing when another worker already claimed the batch (no double run)', async () => {
    const { svc, prisma } = build();
    prisma.importBatch.updateMany.mockResolvedValueOnce({ count: 0 });
    await svc.run({ batchId: 'b1', vendorId: 'v1' });
    expect(executeRow).not.toHaveBeenCalled();
  });
});
