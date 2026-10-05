import { BadRequestException } from '@nestjs/common';
import { CrewRole } from '@prisma/client';
import { resolveEffectiveSalesmanId, splitSalesmanFromCrew } from './crew-validation';

describe('resolveEffectiveSalesmanId', () => {
  it('prefers a SALESMAN in the van default crew', () => {
    expect(
      resolveEffectiveSalesmanId(
        { defaultSalesmanId: 'van-salesman', defaultCrew: [{ userId: 'crew-salesman', role: CrewRole.SALESMAN }] },
        'driver',
      ),
    ).toBe('crew-salesman');
  });

  it('falls back to the van default salesman', () => {
    expect(
      resolveEffectiveSalesmanId(
        { defaultSalesmanId: 'van-salesman', defaultCrew: [{ userId: 'l1', role: CrewRole.LOADER }] },
        'driver',
      ),
    ).toBe('van-salesman');
  });

  it('falls back to the driver when no salesman exists anywhere', () => {
    expect(resolveEffectiveSalesmanId({ defaultCrew: [] }, 'driver')).toBe('driver');
    expect(resolveEffectiveSalesmanId({}, 'driver')).toBe('driver');
  });
});

describe('splitSalesmanFromCrew', () => {
  it('separates the salesman from the loaders', () => {
    expect(
      splitSalesmanFromCrew([
        { userId: 's1', role: CrewRole.SALESMAN },
        { userId: 'l1', role: CrewRole.LOADER },
      ]),
    ).toEqual({ salesmanId: 's1', loaders: [{ userId: 'l1', role: CrewRole.LOADER }] });
  });

  it('returns an undefined salesman when none is named', () => {
    expect(splitSalesmanFromCrew([{ userId: 'l1', role: CrewRole.LOADER }]).salesmanId).toBeUndefined();
    expect(splitSalesmanFromCrew([]).salesmanId).toBeUndefined();
  });

  it('rejects more than one salesman', () => {
    expect(() =>
      splitSalesmanFromCrew([
        { userId: 's1', role: CrewRole.SALESMAN },
        { userId: 's2', role: CrewRole.SALESMAN },
      ]),
    ).toThrow(BadRequestException);
  });
});
