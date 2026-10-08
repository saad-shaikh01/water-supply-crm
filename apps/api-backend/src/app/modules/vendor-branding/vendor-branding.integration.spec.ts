import { randomUUID } from 'crypto';
import { PrismaService } from '@water-supply-crm/database';
import { VendorBrandingService } from './vendor-branding.service';
import { LEGACY_DOC_BRANDING } from '../../common/pdf/legacy-dasani-branding';
import type { UpsertVendorBrandingDto } from './dto/vendor-branding.dto';

/**
 * Real-database test for the per-vendor company profile (multi-vendor design doc §3.1, P1).
 *
 * Opt-in: set TEST_DATABASE_URL to a THROWAWAY database with the schema applied
 * (migration 20261009000000_add_vendor_branding). It never falls back to DATABASE_URL.
 *
 *   TEST_DATABASE_URL=postgresql://... npx jest -c jest.config.cts vendor-branding.integration
 */
const TEST_DATABASE_URL = process.env['TEST_DATABASE_URL'];
const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

jest.setTimeout(60000);

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

describeDb('VendorBranding (real Postgres)', () => {
  const RUN = randomUUID().slice(0, 8);
  const prisma = new PrismaService({ datasources: { db: { url: TEST_DATABASE_URL ?? 'postgresql://skipped:skipped@localhost:1/skipped' } } });
  const storage = {
    upload: jest.fn(async (_prefix: string, _buf: Buffer, _name: string, _mime: string, vendorId: string) => ({ key: `vendor-branding/logo/${vendorId}/${RUN}.png` })),
    getObjectBuffer: jest.fn(async () => PNG),
    getSignedUrl: jest.fn(async (k: string) => `https://signed.example/${k}`),
  };
  const audit = { log: jest.fn(async () => undefined) };
  const service = new VendorBrandingService(prisma, storage as never, audit as never, {} as never, {} as never);
  const actor = { userId: 'u-test', name: 'Tester', vendorId: 'x' } as never;

  const vendorIds: string[] = [];
  const mkVendor = async (tag: string) => {
    const v = await prisma.vendor.create({ data: { name: `Lorem ${tag}`, slug: `vb-${RUN}-${tag}`, address: `${tag} address` } });
    vendorIds.push(v.id);
    return v;
  };

  const dto = (over: Record<string, unknown> = {}) =>
    ({
      displayName: 'LOREM WATER',
      legalName: 'LOREM BEVERAGES',
      address: '12 Canal Road, Lahore',
      phones: 'Cell# 0300-1111111',
      email: 'hello@lorem.pk',
      website: 'lorem.pk',
      ntn: '1234567-8',
      strn: null,
      primaryColor: '#065f46',
      accentColor: null,
      invoiceFooter: 'Thank you',
      paymentAccounts: [
        { kind: 'BANK', accountTitle: 'LOREM BEVERAGES', bankName: 'HBL', accountNumber: '1234-5678', iban: 'PK36SCBL0000001123456702', branch: null, note: null },
        { kind: 'EASYPAISA', accountTitle: 'LOREM BEVERAGES', accountNumber: '03001111111' },
      ],
      ...over,
    }) as unknown as UpsertVendorBrandingDto;

  afterAll(async () => {
    await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } }); // VendorBranding cascades
    await prisma.$disconnect();
  });

  it('a new vendor has no row; completeness lists what is missing; the form is pre-filled from the vendor record', async () => {
    const v = await mkVendor('a');
    const view = await service.get(v.id);
    expect(view.exists).toBe(false);
    expect(view.missing).toEqual(['displayName', 'address', 'phones', 'paymentAccounts']);
    expect(view.suggested).toEqual({ displayName: `Lorem a`, address: 'a address' });
  });

  it('upsert persists the profile (JSON accounts round-trip in order) and documents are drawn from it — nothing of Dasani', async () => {
    const v = await mkVendor('b');
    const view = await service.upsert(v.id, dto(), actor);
    expect(view.exists).toBe(true);
    expect(view.missing).toEqual([]);
    expect(view.branding?.paymentAccounts.map((a) => a.kind)).toEqual(['BANK', 'EASYPAISA']);
    expect(view.branding?.paymentAccounts[0]).toEqual({ kind: 'BANK', accountTitle: 'LOREM BEVERAGES', bankName: 'HBL', accountNumber: '1234-5678', iban: 'PK36SCBL0000001123456702' });

    const doc = await service.resolveForDocs(v.id);
    expect(doc).toMatchObject({ name: 'LOREM WATER', payTo: 'LOREM BEVERAGES', phones: 'Cell# 0300-1111111', taxLine: 'NTN: 1234567-8', gradient: { dark: '#065f46' } });
    expect(JSON.stringify(doc)).not.toMatch(/DASANI|Meezan|9933|blueice/i);
  });

  it('a second save updates in place (one row per vendor) and clears optional fields', async () => {
    const v = await mkVendor('c');
    await service.upsert(v.id, dto(), actor);
    await service.upsert(v.id, dto({ displayName: 'LOREM 2', website: null, paymentAccounts: [] }), actor);
    expect(await prisma.vendorBranding.count({ where: { vendorId: v.id } })).toBe(1);
    const view = await service.get(v.id);
    expect(view.branding?.displayName).toBe('LOREM 2');
    expect(view.branding?.website).toBeNull();
    expect(view.missing).toEqual(['paymentAccounts']);
  });

  it('vendor isolation: one vendor’s profile never leaks into another’s documents', async () => {
    const a = await mkVendor('d');
    const b = await mkVendor('e');
    await service.upsert(a.id, dto(), actor);
    // b has no profile; default gate mode keeps legacy for it, but it is certainly NOT a's data
    const docB = await service.resolveForDocs(b.id);
    expect(docB.name).not.toBe('LOREM WATER');
    expect(docB).toBe(LEGACY_DOC_BRANDING);
    expect((await service.get(b.id)).exists).toBe(false);
  });

  it('uploading an image to a vendor with no row creates the row from the vendor name; logo is read back for documents', async () => {
    const v = await mkVendor('f');
    const view = await service.setImage(v.id, 'logo', { buffer: PNG, originalname: 'l.png', size: PNG.length }, actor);
    expect(view.exists).toBe(true);
    expect(view.branding?.displayName).toBe('Lorem f');
    expect(view.logoUrl).toContain(`/vendor-branding/logo/${v.id}/`);
    expect(Buffer.isBuffer((await service.resolveForDocs(v.id)).logo)).toBe(true);

    const removed = await service.removeImage(v.id, 'logo', actor);
    expect(removed.branding?.logoKey).toBeNull();
  });

  it('deleting the vendor removes its profile (FK cascade)', async () => {
    const v = await mkVendor('g');
    await service.upsert(v.id, dto(), actor);
    await prisma.vendor.delete({ where: { id: v.id } });
    vendorIds.splice(vendorIds.indexOf(v.id), 1);
    expect(await prisma.vendorBranding.count({ where: { vendorId: v.id } })).toBe(0);
  });
});
