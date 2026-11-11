import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateVendorDto } from './create-vendor.dto';
import { UpdateVendorDto } from './update-vendor.dto';
import { ResetAdminPasswordDto } from './reset-admin-password.dto';
import { BulkVendorActionDto } from './bulk-vendor-action.dto';
import { ListVendorsQueryDto } from './list-vendors-query.dto';

// same options as main.ts
async function check<T extends object>(cls: new () => T, plain: Record<string, unknown>) {
  const dto = plainToInstance(cls, plain, { enableImplicitConversion: true });
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  return { dto, props: errors.map((e) => e.property) };
}

const uuid = '11111111-1111-4111-8111-111111111111';
const goodCreate = { name: 'Acme', slug: 'acme', adminEmail: 'A@X.com ', adminPassword: 'Passw0rd1', adminName: 'Ada' };

describe('CreateVendorDto', () => {
  it('accepts a valid body and normalises email', async () => {
    const { dto, props } = await check(CreateVendorDto, goodCreate);
    expect(props).toEqual([]);
    expect(dto.adminEmail).toBe('a@x.com');
  });
  it.each(['Acme', 'a b', '-x', 'x-', 'a', 'a--b'])('rejects slug %p', async (slug) => {
    expect((await check(CreateVendorDto, { ...goodCreate, slug })).props).toContain('slug');
  });
  it.each(['Abc1234', 'a'.repeat(73), 'onlyletters', '12345678'])('rejects password %p', async (adminPassword) => {
    expect((await check(CreateVendorDto, { ...goodCreate, adminPassword })).props).toContain('adminPassword');
  });
  it('accepts 8 and 72 char passwords', async () => {
    expect((await check(CreateVendorDto, { ...goodCreate, adminPassword: 'Abcdefg1' })).props).toEqual([]);
    expect((await check(CreateVendorDto, { ...goodCreate, adminPassword: 'A1' + 'b'.repeat(70) })).props).toEqual([]);
  });
  it('rejects blank name and overlong adminName', async () => {
    expect((await check(CreateVendorDto, { ...goodCreate, name: '   ' })).props).toContain('name');
    expect((await check(CreateVendorDto, { ...goodCreate, adminName: 'x'.repeat(101) })).props).toContain('adminName');
  });
});

describe('UpdateVendorDto', () => {
  it('accepts name/address/raastId', async () => {
    expect((await check(UpdateVendorDto, { name: 'N', address: 'A', raastId: '03001234567' })).props).toEqual([]);
  });
  it('rejects isActive and slug (forbidNonWhitelisted)', async () => {
    expect((await check(UpdateVendorDto, { isActive: false })).props).toContain('isActive');
    expect((await check(UpdateVendorDto, { slug: 'x' })).props).toContain('slug');
  });
});

describe('ResetAdminPasswordDto', () => {
  const good = { newPassword: 'Passw0rd1', superAdminPassword: 'x' };
  it('accepts valid', async () => expect((await check(ResetAdminPasswordDto, good)).props).toEqual([]));
  it.each([['Abc1234'], ['a'.repeat(73)], ['allletters']])('rejects newPassword %p', async (newPassword) => {
    expect((await check(ResetAdminPasswordDto, { ...good, newPassword })).props).toContain('newPassword');
  });
  it('requires superAdminPassword', async () => {
    expect((await check(ResetAdminPasswordDto, { newPassword: good.newPassword })).props).toContain('superAdminPassword');
  });
  it('rejects non-UUID adminUserId, accepts a UUID', async () => {
    expect((await check(ResetAdminPasswordDto, { ...good, adminUserId: 'nope' })).props).toContain('adminUserId');
    expect((await check(ResetAdminPasswordDto, { ...good, adminUserId: uuid })).props).toEqual([]);
  });
});

describe('BulkVendorActionDto', () => {
  it('accepts 1..25 unique uuids', async () => {
    expect((await check(BulkVendorActionDto, { vendorIds: [uuid] })).props).toEqual([]);
  });
  it('rejects >25, duplicates, empty, non-uuid', async () => {
    const many = Array.from({ length: 26 }, (_, i) => `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`);
    expect((await check(BulkVendorActionDto, { vendorIds: many })).props).toContain('vendorIds');
    expect((await check(BulkVendorActionDto, { vendorIds: [uuid, uuid] })).props).toContain('vendorIds');
    expect((await check(BulkVendorActionDto, { vendorIds: [] })).props).toContain('vendorIds');
    expect((await check(BulkVendorActionDto, { vendorIds: ['x'] })).props).toContain('vendorIds');
  });
});

describe('ListVendorsQueryDto', () => {
  it('defaults and accepts whitelisted values', async () => {
    const { dto, props } = await check(ListVendorsQueryDto, { sort: 'name', order: 'asc', status: 'live', page: '2' });
    expect(props).toEqual([]);
    expect(dto.page).toBe(2);
  });
  it('rejects invalid sort/status/order', async () => {
    expect((await check(ListVendorsQueryDto, { sort: 'password' })).props).toContain('sort');
    expect((await check(ListVendorsQueryDto, { status: 'zzz' })).props).toContain('status');
    expect((await check(ListVendorsQueryDto, { order: 'up' })).props).toContain('order');
  });
});
