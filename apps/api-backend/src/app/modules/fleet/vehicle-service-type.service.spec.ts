import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  VehicleServiceTypeService,
  prettifyServiceTypeKey,
  slugifyServiceTypeKey,
} from './vehicle-service-type.service';

const VENDOR_ID = 'vendor-1';
const USER = { vendorId: VENDOR_ID, userId: 'user-1', name: 'Admin' } as any;

function makeService(overrides: { defs?: any[]; usage?: Record<string, number>; records?: any[] } = {}) {
  const defs = overrides.defs ?? [];
  const usage = overrides.usage ?? {};

  const tx = {
    vehicleServiceRecord: {
      count: jest.fn(async ({ where }: any) => usage[where.serviceType] ?? 0),
      findMany: jest.fn(async () => overrides.records ?? []),
    },
    vehicleMaintenanceRule: { deleteMany: jest.fn(async () => ({ count: 1 })) },
    vehicleServiceTypeDef: {
      delete: jest.fn(async () => ({})),
      update: jest.fn(async ({ where, data }: any) => ({ ...defs.find((d) => d.id === where.id), ...data })),
    },
    expense: { updateMany: jest.fn(async () => ({ count: 1 })) },
  };
  const prisma: any = {
    vehicleServiceTypeDef: {
      count: jest.fn(async () => defs.length),
      createMany: jest.fn(async () => ({ count: 19 })),
      findMany: jest.fn(async ({ where }: any) => {
        if (where?.key?.startsWith) return defs.filter((d) => d.key.startsWith(where.key.startsWith));
        return defs;
      }),
      findFirst: jest.fn(async ({ where }: any) => {
        if (where.id) return defs.find((d) => d.id === where.id && d.vendorId === where.vendorId) ?? null;
        const wanted = where.label?.equals?.toLowerCase();
        return defs.find((d) => d.label.toLowerCase() === wanted && d.id !== where.NOT?.id) ?? null;
      }),
      findUnique: jest.fn(async ({ where }: any) => defs.find((d) => d.key === where.vendorId_key.key) ?? null),
      create: jest.fn(async ({ data }: any) => ({ id: 'new-id', isSystem: false, ...data })),
    },
    vehicleServiceRecord: {
      count: jest.fn(async ({ where }: any) => usage[where.serviceType] ?? 0),
      groupBy: jest.fn(async () =>
        Object.entries(usage).map(([serviceType, n]) => ({ serviceType, _count: { _all: n } })),
      ),
    },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  const audit: any = { log: jest.fn(async () => undefined) };
  return { service: new VehicleServiceTypeService(prisma, audit), prisma, audit, tx };
}

const def = (key: string, label: string, extra: Record<string, unknown> = {}) => ({
  id: `id-${key}`,
  vendorId: VENDOR_ID,
  key,
  label,
  defaultIntervalKm: null,
  defaultIntervalDays: null,
  isSystem: false,
  ...extra,
});

describe('slugifyServiceTypeKey / prettifyServiceTypeKey', () => {
  it('slugifies to UPPER_SNAKE', () => {
    expect(slugifyServiceTypeKey('Clutch Plate (front)')).toBe('CLUTCH_PLATE_FRONT');
    expect(slugifyServiceTypeKey('  A/C  gas  ')).toBe('A_C_GAS');
  });

  it('returns empty for labels with no latin letters/digits', () => {
    expect(slugifyServiceTypeKey('انجن آئل')).toBe('');
  });

  it('caps the key length without leaving a trailing underscore', () => {
    const key = slugifyServiceTypeKey('word '.repeat(30));
    expect(key.length).toBeLessThanOrEqual(40);
    expect(key.endsWith('_')).toBe(false);
  });

  it('prettifies a key back to a label', () => {
    expect(prettifyServiceTypeKey('CLUTCH_PLATE')).toBe('Clutch Plate');
  });
});

describe('VehicleServiceTypeService', () => {
  describe('ensureSeeded', () => {
    it('seeds the built-ins (with OTHER as system) for a vendor with no catalogue', async () => {
      const { service, prisma } = makeService({ defs: [] });
      await service.ensureSeeded(VENDOR_ID);
      const { data, skipDuplicates } = prisma.vehicleServiceTypeDef.createMany.mock.calls[0][0];
      expect(skipDuplicates).toBe(true);
      expect(data).toHaveLength(19);
      expect(data.find((d: any) => d.key === 'ENGINE_OIL')).toMatchObject({
        label: 'Engine Oil',
        defaultIntervalKm: 2500,
        defaultIntervalDays: 180,
        isSystem: false,
      });
      expect(data.find((d: any) => d.key === 'OTHER').isSystem).toBe(true);
    });

    it('never re-seeds once a catalogue exists (a deleted built-in stays deleted)', async () => {
      const { service, prisma } = makeService({ defs: [def('OTHER', 'Other', { isSystem: true })] });
      await service.ensureSeeded(VENDOR_ID);
      expect(prisma.vehicleServiceTypeDef.createMany).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('orders built-ins, then custom A-Z, then Other; reports usage counts', async () => {
      const { service } = makeService({
        defs: [
          def('OTHER', 'Other', { isSystem: true }),
          def('ZEBRA_WASH', 'Zebra Wash'),
          def('COOLANT', 'Coolant'),
          def('ALPHA_TUNE', 'Alpha Tune'),
          def('ENGINE_OIL', 'Engine Oil'),
        ],
        usage: { ENGINE_OIL: 3 },
      });
      const rows = await service.list(VENDOR_ID);
      expect(rows.map((r) => r.key)).toEqual(['ENGINE_OIL', 'COOLANT', 'ALPHA_TUNE', 'ZEBRA_WASH', 'OTHER']);
      expect(rows[0].usageCount).toBe(3);
      expect(rows[1].usageCount).toBe(0);
    });
  });

  describe('create', () => {
    it('creates a custom type with a slug key and the optional default intervals', async () => {
      const { service, prisma, audit } = makeService({ defs: [def('OTHER', 'Other', { isSystem: true })] });
      const created = await service.create(USER, { label: '  Clutch   Plate ', defaultIntervalKm: 30000 });
      expect(prisma.vehicleServiceTypeDef.create).toHaveBeenCalledWith({
        data: {
          vendorId: VENDOR_ID,
          key: 'CLUTCH_PLATE',
          label: 'Clutch Plate',
          defaultIntervalKm: 30000,
          defaultIntervalDays: null,
        },
      });
      expect(created).toMatchObject({ key: 'CLUTCH_PLATE', label: 'Clutch Plate', usageCount: 0, isSystem: false });
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'CREATED', entity: 'VehicleServiceTypeDef' }));
    });

    it('rejects a case-insensitive duplicate label', async () => {
      const { service, prisma } = makeService({ defs: [def('ENGINE_OIL', 'Engine Oil')] });
      await expect(service.create(USER, { label: 'engine oil' })).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.vehicleServiceTypeDef.create).not.toHaveBeenCalled();
    });

    it('suffixes the key when the slug collides with an existing key', async () => {
      const { service, prisma } = makeService({ defs: [def('BRAKE_PADS', 'Brake Pads')] });
      await service.create(USER, { label: 'Brake-Pads' });
      expect(prisma.vehicleServiceTypeDef.create.mock.calls[0][0].data.key).toBe('BRAKE_PADS_2');
    });

    it('falls back to a CUSTOM_ key for labels with no latin characters', async () => {
      const { service, prisma } = makeService({ defs: [def('OTHER', 'Other', { isSystem: true })] });
      await service.create(USER, { label: 'انجن آئل' });
      expect(prisma.vehicleServiceTypeDef.create.mock.calls[0][0].data.key).toMatch(/^CUSTOM_[A-Z0-9]+$/);
    });
  });

  describe('rename', () => {
    it('renames in place (key untouched) and re-describes auto-generated expenses per plate', async () => {
      const { service, tx, audit } = makeService({
        defs: [def('COOLANT', 'Coolant')],
        usage: { COOLANT: 2 },
        records: [
          { expenseId: 'e1', vehicle: { plateNumber: 'LEA-1' } },
          { expenseId: 'e2', vehicle: { plateNumber: 'LEA-1' } },
          { expenseId: 'e3', vehicle: { plateNumber: 'LEB-2' } },
        ],
      });
      const result = await service.rename(USER, 'id-COOLANT', { label: '  Coolant   Flush ' });

      expect(tx.vehicleServiceTypeDef.update).toHaveBeenCalledWith({ where: { id: 'id-COOLANT' }, data: { label: 'Coolant Flush' } });
      expect(tx.expense.updateMany).toHaveBeenCalledTimes(2);
      expect(tx.expense.updateMany).toHaveBeenCalledWith({
        where: { vendorId: VENDOR_ID, id: { in: ['e1', 'e2'] }, description: 'Coolant — LEA-1' },
        data: { description: 'Coolant Flush — LEA-1' },
      });
      expect(tx.expense.updateMany).toHaveBeenCalledWith({
        where: { vendorId: VENDOR_ID, id: { in: ['e3'] }, description: 'Coolant — LEB-2' },
        data: { description: 'Coolant Flush — LEB-2' },
      });
      expect(result).toMatchObject({ key: 'COOLANT', label: 'Coolant Flush', usageCount: 2 });
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'UPDATED', entityId: 'id-COOLANT' }));
    });

    it('allows a case-only change of its own name', async () => {
      const { service } = makeService({ defs: [def('COOLANT', 'Coolant')] });
      await expect(service.rename(USER, 'id-COOLANT', { label: 'COOLANT' })).resolves.toMatchObject({ label: 'COOLANT' });
    });

    it('is a no-op when the label is unchanged', async () => {
      const { service, tx } = makeService({ defs: [def('COOLANT', 'Coolant')] });
      await service.rename(USER, 'id-COOLANT', { label: ' Coolant ' });
      expect(tx.vehicleServiceTypeDef.update).not.toHaveBeenCalled();
    });

    it('rejects a name already used by another type', async () => {
      const { service, tx } = makeService({ defs: [def('COOLANT', 'Coolant'), def('RADIATOR', 'Radiator')] });
      await expect(service.rename(USER, 'id-COOLANT', { label: 'radiator' })).rejects.toBeInstanceOf(ConflictException);
      expect(tx.vehicleServiceTypeDef.update).not.toHaveBeenCalled();
    });

    it('404s for another vendor\'s type', async () => {
      const { service } = makeService({ defs: [def('COOLANT', 'Coolant')] });
      await expect(service.rename({ ...USER, vendorId: 'other' }, 'id-COOLANT', { label: 'X Y' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('removes an unused type together with its per-vehicle rules', async () => {
      const { service, tx, audit } = makeService({ defs: [def('CLUTCH_PLATE', 'Clutch Plate')] });
      await expect(service.remove(USER, 'id-CLUTCH_PLATE')).resolves.toEqual({ deleted: true });
      expect(tx.vehicleMaintenanceRule.deleteMany).toHaveBeenCalledWith({
        where: { vendorId: VENDOR_ID, serviceType: 'CLUTCH_PLATE' },
      });
      expect(tx.vehicleServiceTypeDef.delete).toHaveBeenCalledWith({ where: { id: 'id-CLUTCH_PLATE' } });
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'DELETED' }));
    });

    it('blocks removal when any service record uses the type (built-in or custom)', async () => {
      const { service, tx } = makeService({
        defs: [def('ENGINE_OIL', 'Engine Oil')],
        usage: { ENGINE_OIL: 2 },
      });
      await expect(service.remove(USER, 'id-ENGINE_OIL')).rejects.toThrow(/used in 2 service records/);
      expect(tx.vehicleMaintenanceRule.deleteMany).not.toHaveBeenCalled();
      expect(tx.vehicleServiceTypeDef.delete).not.toHaveBeenCalled();
    });

    it('never removes the system type', async () => {
      const { service } = makeService({ defs: [def('OTHER', 'Other', { isSystem: true })] });
      await expect(service.remove(USER, 'id-OTHER')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('404s for another vendor\'s / unknown type', async () => {
      const { service } = makeService({ defs: [def('CLUTCH_PLATE', 'Clutch Plate')] });
      await expect(service.remove({ ...USER, vendorId: 'other-vendor' }, 'id-CLUTCH_PLATE')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('assertKeyExists', () => {
    it('returns the label for a known key and 400s for an unknown one', async () => {
      const { service } = makeService({ defs: [def('COOLANT', 'Coolant')] });
      await expect(service.assertKeyExists(VENDOR_ID, 'COOLANT')).resolves.toBe('Coolant');
      await expect(service.assertKeyExists(VENDOR_ID, 'NOPE')).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
