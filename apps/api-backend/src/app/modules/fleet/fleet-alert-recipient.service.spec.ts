import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FleetAlertRecipientService } from './fleet-alert-recipient.service';

const VENDOR_ID = 'vendor-1';
const USER = { vendorId: VENDOR_ID, userId: 'user-1', name: 'Admin' } as any;

function makeService(rows: any[] = []) {
  const prisma: any = {
    fleetAlertRecipient: {
      findMany: jest.fn(async ({ where }: any) =>
        rows.filter((r) => r.vendorId === where.vendorId && (where.isActive === undefined || r.isActive === where.isActive)),
      ),
      findFirst: jest.fn(async ({ where }: any) => rows.find((r) => r.id === where.id && r.vendorId === where.vendorId) ?? null),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: 'new-id', isActive: true, createdAt: new Date(), updatedAt: new Date(), ...data };
        rows.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = rows.find((r) => r.id === where.id);
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      }),
      delete: jest.fn(async ({ where }: any) => {
        const idx = rows.findIndex((r) => r.id === where.id);
        rows.splice(idx, 1);
        return {};
      }),
    },
  };
  const audit: any = { log: jest.fn(async () => undefined) };
  return { service: new FleetAlertRecipientService(prisma, audit), prisma, audit, rows };
}

const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  vendorId: VENDOR_ID,
  name: 'Owner',
  phone: '923001234567',
  isActive: true,
  createdById: 'user-1',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...extra,
});

describe('FleetAlertRecipientService', () => {
  describe('create', () => {
    it('normalizes the phone and rejects an unsendable one', async () => {
      const { service } = makeService();
      const created = await service.create(USER, { name: 'Owner', phone: '0300-1234567' });
      expect(created.phone).toBe('923001234567');
    });

    it('throws BadRequestException for a garbage phone', async () => {
      const { service } = makeService();
      await expect(service.create(USER, { name: 'Owner', phone: '-' })).rejects.toThrow(BadRequestException);
    });

    it('trims/collapses whitespace in the name', async () => {
      const { service } = makeService();
      const created = await service.create(USER, { name: '  Ali   Khan  ', phone: '03001234567' });
      expect(created.name).toBe('Ali Khan');
    });
  });

  describe('update', () => {
    it('404s for a recipient from another vendor', async () => {
      const { service } = makeService([row('r1', { vendorId: 'other-vendor' })]);
      await expect(service.update(USER, 'r1', { name: 'X' })).rejects.toThrow(NotFoundException);
    });

    it('can deactivate without touching name/phone', async () => {
      const { service } = makeService([row('r1')]);
      const updated = await service.update(USER, 'r1', { isActive: false });
      expect(updated.isActive).toBe(false);
      expect(updated.phone).toBe('923001234567');
    });

    it('rejects an invalid phone on update', async () => {
      const { service } = makeService([row('r1')]);
      await expect(service.update(USER, 'r1', { phone: 'abc' })).rejects.toThrow(BadRequestException);
    });
  });

  describe('remove', () => {
    it('404s for a missing id', async () => {
      const { service } = makeService([]);
      await expect(service.remove(USER, 'missing')).rejects.toThrow(NotFoundException);
    });

    it('deletes an existing row', async () => {
      const { service, rows } = makeService([row('r1')]);
      const result = await service.remove(USER, 'r1');
      expect(result).toEqual({ deleted: true });
      expect(rows).toHaveLength(0);
    });
  });

  describe('listActivePhones', () => {
    it('only returns active, sendable-phone rows', async () => {
      const { service } = makeService([
        row('r1', { isActive: true, phone: '923001234567' }),
        row('r2', { isActive: false, phone: '923009999999' }),
      ]);
      const active = await service.listActivePhones(VENDOR_ID);
      expect(active).toHaveLength(1);
      expect(active[0]).toMatchObject({ name: 'Owner', phone: '923001234567' });
    });
  });
});
