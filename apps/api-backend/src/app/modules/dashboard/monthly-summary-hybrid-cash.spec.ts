import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '@water-supply-crm/database';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import { DashboardService } from './dashboard.service';

/**
 * Hybrid cash rollups (docs/features/post-close-divergence-banner.md
 * §"Hybrid cash rollups"): getMonthlySummary must recompute cash live for
 * closed sheets edited after close, while leaving untouched months
 * byte-identical to a plain Σ of the frozen DailySheet columns.
 */

function makeService(mockPrisma: any) {
  return Test.createTestingModule({
    providers: [
      DashboardService,
      { provide: PrismaService, useValue: mockPrisma },
      {
        provide: CacheInvalidationService,
        useValue: {
          vendorKey: (_v: string, e: string) => `k:${e}`,
          get: jest.fn().mockResolvedValue(null),
          set: jest.fn().mockResolvedValue(undefined),
        },
      },
    ],
  }).compile().then((m: TestingModule) => m.get(DashboardService));
}

describe('DashboardService.getMonthlySummary — hybrid cash', () => {
  it('recomputes cash (→ ~0) for a closed sheet whose only delivery is voided', async () => {
    const mockPrisma: any = {
      dailySheetItem: {
        findMany: jest.fn(({ where }: any) => {
          // modified-detection pass carries an OR clause + selects only the id
          if (where.OR) return Promise.resolve([{ dailySheetId: 's1' }]);
          // bottle pass — the voided item is excluded by the status filter
          return Promise.resolve([]);
        }),
      },
      dailySheetLoad: { findMany: jest.fn().mockResolvedValue([]) },
      dailySheet: {
        findMany: jest.fn(({ include }: any) => {
          if (include) {
            // targeted full re-load of the modified sheet
            return Promise.resolve([
              {
                id: 's1',
                isClosed: true,
                filledOutCount: 0,
                filledInCount: 0,
                emptyInCount: 0,
                cashCollected: 4800,
                cashExpected: 5000,
                items: [
                  {
                    status: 'VOIDED',
                    voidedAt: new Date(),
                    isCorrection: false,
                    correctionAddedAt: null,
                    cashCollected: 500,
                    filledDropped: 0,
                    filledReceived: 0,
                    emptyReceived: 0,
                    pricePerBottle: 100,
                    productId: 'p1',
                    customer: { paymentType: 'CASH', customPrices: [] },
                    product: { basePrice: 100 },
                  },
                ],
                expenses: [],
                crewCashDistributions: [],
                loads: [],
              },
            ]);
          }
          // light per-month list
          return Promise.resolve([
            { id: 's1', date: new Date(), cashExpected: 5000, cashCollected: 4800 },
          ]);
        }),
      },
    };

    const service = await makeService(mockPrisma);
    const res = await service.getMonthlySummary('vendor-1', 1);

    expect(res).toHaveLength(1);
    expect(res[0].cashCollected).toBe(0);
    expect(res[0].cashExpected).toBe(0);
    expect(res[0].collectionRate).toBe(0);
    expect(res[0].hasModifiedClosedSheets).toBe(true);
  });

  it('untouched closed sheets → cash sums exactly equal Σ frozen columns', async () => {
    const frozen = [
      { id: 's2', date: new Date(), cashExpected: 3000, cashCollected: 2500 },
      { id: 's3', date: new Date(), cashExpected: 1000, cashCollected: 900 },
    ];
    const reloadSpy = jest.fn();
    const mockPrisma: any = {
      dailySheetItem: {
        findMany: jest.fn().mockResolvedValue([]), // no bottles, no modified items
      },
      dailySheetLoad: { findMany: jest.fn().mockResolvedValue([]) },
      dailySheet: {
        findMany: jest.fn(({ include }: any) => {
          if (include) {
            reloadSpy();
            return Promise.resolve([]);
          }
          return Promise.resolve(frozen);
        }),
      },
    };

    const service = await makeService(mockPrisma);
    const res = await service.getMonthlySummary('vendor-1', 1);

    const sumExpected = frozen.reduce((s, f) => s + f.cashExpected, 0);
    const sumCollected = frozen.reduce((s, f) => s + f.cashCollected, 0);
    expect(res[0].cashExpected).toBe(sumExpected); // 4000
    expect(res[0].cashCollected).toBe(sumCollected); // 3400
    expect(res[0].collectionRate).toBe(Math.round((sumCollected / sumExpected) * 100)); // 85
    expect(res[0].hasModifiedClosedSheets).toBe(false);
    // no modified sheets → no targeted re-load query at all
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('only the modified sheet in a month is recomputed; the rest stay frozen', async () => {
    const mockPrisma: any = {
      dailySheetItem: {
        findMany: jest.fn(({ where }: any) =>
          Promise.resolve(where.OR ? [{ dailySheetId: 's1' }] : []),
        ),
      },
      dailySheetLoad: { findMany: jest.fn().mockResolvedValue([]) },
      dailySheet: {
        findMany: jest.fn(({ include }: any) => {
          if (include) {
            return Promise.resolve([
              {
                id: 's1',
                isClosed: true,
                filledOutCount: 0,
                filledInCount: 0,
                emptyInCount: 0,
                cashCollected: 1000,
                cashExpected: 1000,
                items: [
                  {
                    status: 'VOIDED',
                    voidedAt: new Date(),
                    isCorrection: false,
                    correctionAddedAt: null,
                    cashCollected: 1000,
                    filledDropped: 0,
                    filledReceived: 0,
                    emptyReceived: 0,
                    pricePerBottle: 100,
                    productId: 'p1',
                    customer: { paymentType: 'CASH', customPrices: [] },
                    product: { basePrice: 100 },
                  },
                ],
                expenses: [],
                crewCashDistributions: [],
                loads: [],
              },
            ]);
          }
          return Promise.resolve([
            { id: 's1', date: new Date(), cashExpected: 1000, cashCollected: 1000 },
            { id: 's-untouched', date: new Date(), cashExpected: 2000, cashCollected: 1800 },
          ]);
        }),
      },
    };

    const service = await makeService(mockPrisma);
    const res = await service.getMonthlySummary('vendor-1', 1);

    // s1 recomputed to 0, s-untouched keeps frozen 2000 / 1800
    expect(res[0].cashExpected).toBe(2000);
    expect(res[0].cashCollected).toBe(1800);
    expect(res[0].hasModifiedClosedSheets).toBe(true);
  });
});
