import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BUILTIN_LOGO_KEY, VendorBrandingService, missingRequired, parsePaymentAccounts } from './vendor-branding.service';
import { LEGACY_DOC_BRANDING } from '../../common/pdf/legacy-dasani-branding';
import { resetGateLogThrottle } from '../../common/tenant-gate/legacy-vendor-gate';
import type { UpsertVendorBrandingDto } from './dto/vendor-branding.dto';

const ENV_KEYS = ['WHATSAPP_GUARD_MODE', 'WHATSAPP_ALLOWED_VENDOR_IDS'] as const;
const actor = { userId: 'u1', name: 'Admin', vendorId: 'v-lorem' } as any;

// 1x1 transparent PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);

const row = (over: Record<string, unknown> = {}) => ({
  vendorId: 'v-lorem',
  displayName: 'Lorem Water',
  legalName: 'Lorem Beverages (Pvt) Ltd',
  address: 'Lahore',
  phones: '0300-1111111',
  email: 'hello@lorem.pk',
  website: 'lorem.pk',
  ntn: '1234567-8',
  strn: null,
  logoKey: null,
  iconKey: null,
  primaryColor: null,
  accentColor: null,
  paymentAccounts: [{ kind: 'BANK', accountTitle: 'Lorem Beverages', bankName: 'HBL', accountNumber: '1234-5678' }],
  invoiceFooter: null,
  updatedById: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

describe('VendorBrandingService', () => {
  const saved: Record<string, string | undefined> = {};
  let prisma: any;
  let storage: { upload: jest.Mock; getObjectBuffer: jest.Mock; getSignedUrl: jest.Mock };
  let audit: { log: jest.Mock };
  let service: VendorBrandingService;

  beforeEach(() => {
    ENV_KEYS.forEach((k) => {
      saved[k] = process.env[k];
      delete process.env[k];
    });
    resetGateLogThrottle();
    prisma = {
      vendor: { findUnique: jest.fn().mockResolvedValue({ id: 'v-lorem', name: 'Lorem', address: 'Lahore addr' }) },
      vendorBranding: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    storage = {
      upload: jest.fn().mockResolvedValue({ key: 'vendor-branding/logo/v-lorem/x.png' }),
      getObjectBuffer: jest.fn().mockResolvedValue(PNG),
      getSignedUrl: jest.fn().mockResolvedValue('https://signed'),
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    service = new VendorBrandingService(prisma, storage as any, audit as any, {} as any, {} as any);
  });
  afterEach(() => {
    ENV_KEYS.forEach((k) => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    });
  });

  describe('resolveForDocs', () => {
    it('uses the vendor row: own name, payTo = legal name, accounts, tax line', async () => {
      prisma.vendorBranding.findUnique.mockResolvedValue(row());
      const b = await service.resolveForDocs('v-lorem');
      expect(b).toMatchObject({
        name: 'Lorem Water',
        payTo: 'Lorem Beverages (Pvt) Ltd',
        address: 'Lahore',
        phones: '0300-1111111',
        email: 'hello@lorem.pk',
        website: 'lorem.pk',
        taxLine: 'NTN: 1234567-8',
        logo: null,
        gradient: null,
      });
      expect(b.paymentAccounts).toEqual([{ kind: 'BANK', accountTitle: 'Lorem Beverages', bankName: 'HBL', accountNumber: '1234-5678' }]);
      expect(JSON.stringify(b)).not.toMatch(/DASANI|Meezan|9933/);
    });

    it('Dasani backfill row (builtin sentinel) resolves to the bundled-asset marker', async () => {
      prisma.vendorBranding.findUnique.mockResolvedValue(row({ displayName: 'DASANI ENTERPRISES', logoKey: BUILTIN_LOGO_KEY, iconKey: BUILTIN_LOGO_KEY }));
      const b = await service.resolveForDocs('v-bi');
      expect(b.logo).toBe('builtin');
      expect(b.icon).toBe('builtin');
      expect(storage.getObjectBuffer).not.toHaveBeenCalled();
    });

    it('downloads an uploaded logo once and serves it from the cache afterwards', async () => {
      prisma.vendorBranding.findUnique.mockResolvedValue(row({ logoKey: 'k1' }));
      const a = await service.resolveForDocs('v-lorem');
      expect(Buffer.isBuffer(a.logo)).toBe(true);
      await service.resolveForDocs('v-lorem');
      expect(prisma.vendorBranding.findUnique).toHaveBeenCalledTimes(1); // doc cache
      expect(storage.getObjectBuffer).toHaveBeenCalledTimes(1);
    });

    it('a logo that cannot be downloaded degrades to "no logo", never to an error', async () => {
      prisma.vendorBranding.findUnique.mockResolvedValue(row({ logoKey: 'k2' }));
      storage.getObjectBuffer.mockRejectedValue(new Error('wasabi down'));
      expect((await service.resolveForDocs('v-lorem')).logo).toBeNull();
    });

    it('colours: primary alone derives a lighter end; accent alone keeps the default dark end', async () => {
      prisma.vendorBranding.findUnique.mockResolvedValue(row({ primaryColor: '#000000' }));
      const a = await service.resolveForDocs('v-a');
      expect(a.gradient).toEqual({ dark: '#000000', light: '#8c8c8c' });
      prisma.vendorBranding.findUnique.mockResolvedValue(row({ accentColor: '#112233' }));
      const b = await service.resolveForDocs('v-b');
      expect(b.gradient).toEqual({ light: '#112233', dark: '#0d0d5e' });
    });

    it('no row + default (shadow) gate: legacy Dasani values so Blue Ice can never degrade', async () => {
      expect(await service.resolveForDocs('v-bi')).toBe(LEGACY_DOC_BRANDING);
    });

    it('no row + enforce: allow-listed vendor keeps legacy, any other vendor gets a neutral identity (no bank, no logo)', async () => {
      process.env['WHATSAPP_GUARD_MODE'] = 'enforce';
      process.env['WHATSAPP_ALLOWED_VENDOR_IDS'] = 'v-bi';
      expect(await service.resolveForDocs('v-bi')).toBe(LEGACY_DOC_BRANDING);
      const n = await service.resolveForDocs('v-lorem');
      expect(n).toMatchObject({ name: 'Lorem', payTo: 'Lorem', address: 'Lahore addr', logo: null, paymentAccounts: [] });
    });

    it('a failing DB read falls back the same way and is NOT cached', async () => {
      prisma.vendorBranding.findUnique.mockRejectedValueOnce(new Error('relation does not exist'));
      expect(await service.resolveForDocs('v-bi')).toBe(LEGACY_DOC_BRANDING);
      prisma.vendorBranding.findUnique.mockResolvedValue(row());
      expect((await service.resolveForDocs('v-bi')).name).toBe('Lorem Water'); // recovered — not stuck on the fallback
    });
  });

  describe('upsert', () => {
    const dto = {
      displayName: 'Lorem Water',
      legalName: null,
      address: 'Lahore',
      phones: '0300',
      paymentAccounts: [{ kind: 'BANK', accountTitle: 'Lorem', bankName: 'HBL', accountNumber: '1234-5678', iban: null, branch: '', note: undefined }],
    } as unknown as UpsertVendorBrandingDto;

    it('stores cleaned accounts (no null/empty keys), scopes by vendor, audits CREATE and busts the doc cache', async () => {
      prisma.vendorBranding.findUnique.mockResolvedValueOnce(row()).mockResolvedValue(row());
      await service.resolveForDocs('v-lorem'); // warm the cache
      prisma.vendorBranding.findUnique.mockReset().mockResolvedValue(null);
      await service.upsert('v-lorem', dto, actor);

      const call = prisma.vendorBranding.upsert.mock.calls[0][0];
      expect(call.where).toEqual({ vendorId: 'v-lorem' });
      expect(call.create.vendorId).toBe('v-lorem');
      expect(call.update.paymentAccounts).toEqual([{ kind: 'BANK', accountTitle: 'Lorem', bankName: 'HBL', accountNumber: '1234-5678' }]);
      expect(call.update.updatedById).toBe('u1');
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ vendorId: 'v-lorem', action: 'CREATE', entity: 'VendorBranding' }));

      prisma.vendorBranding.findUnique.mockResolvedValue(row({ displayName: 'Changed' }));
      expect((await service.resolveForDocs('v-lorem')).name).toBe('Changed'); // cache was busted
    });

    it('rejects an unknown vendor', async () => {
      prisma.vendor.findUnique.mockResolvedValue(null);
      await expect(service.upsert('nope', dto, actor)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('setImage', () => {
    const file = (buffer: Buffer, size = buffer.length) => ({ buffer, originalname: 'x.png', size });

    it('accepts PNG and JPEG, stores the key under the vendor, creates the row from the vendor name when none exists', async () => {
      await service.setImage('v-lorem', 'logo', file(PNG), actor);
      expect(storage.upload).toHaveBeenCalledWith('vendor-branding/logo', PNG, 'logo.png', 'image/png', 'v-lorem');
      expect(prisma.vendorBranding.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ vendorId: 'v-lorem', displayName: 'Lorem', logoKey: 'vendor-branding/logo/v-lorem/x.png' }),
      });
      prisma.vendorBranding.findUnique.mockResolvedValue(row());
      await service.setImage('v-lorem', 'icon', file(JPEG), actor);
      expect(prisma.vendorBranding.update).toHaveBeenCalledWith({
        where: { vendorId: 'v-lorem' },
        data: expect.objectContaining({ iconKey: expect.any(String) }),
      });
    });

    it('rejects non-PNG/JPEG content even if the filename lies, and files over 1 MB', async () => {
      await expect(service.setImage('v-lorem', 'logo', file(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), actor)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.setImage('v-lorem', 'logo', file(Buffer.concat([PNG, Buffer.alloc(1024 * 1024)])), actor)).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.upload).not.toHaveBeenCalled();
    });
  });

  describe('customer portal branding', () => {
    const vendorRow = (over: Record<string, unknown> = {}) => ({ slug: 'lorem', name: 'Lorem', isActive: true, branding: row({ logoKey: 'k-logo', primaryColor: '#065f46' }), ...over });

    it('exposes only brand identity — name, logo URL, colours, slug — never contacts, bank details or internal ids', async () => {
      prisma.vendor.findUnique.mockResolvedValue(vendorRow());
      const b = await service.publicBrandingForVendor('v-lorem');
      expect(b).toEqual({ slug: 'lorem', name: 'Lorem Water', logoUrl: 'https://signed', builtinLogo: false, primaryColor: '#065f46', accentColor: null });
      expect(JSON.stringify(b)).not.toMatch(/phones|email|iban|accountNumber|paymentAccounts|vendorId|ntn/i);
    });

    it('the Dasani builtin logo is flagged so the portal keeps its bundled artwork (no signed URL)', async () => {
      prisma.vendor.findUnique.mockResolvedValue(vendorRow({ slug: 'blue-ice', branding: row({ displayName: 'DASANI ENTERPRISES', logoKey: BUILTIN_LOGO_KEY }) }));
      const b = await service.publicBrandingForVendor('v-bi');
      expect(b).toMatchObject({ builtinLogo: true, logoUrl: null });
      expect(storage.getSignedUrl).not.toHaveBeenCalled();
    });

    it('Blue Ice without a profile row still gets the bundled artwork (allow-listed), other vendors a plain name', async () => {
      process.env['WHATSAPP_ALLOWED_VENDOR_IDS'] = 'v-bi';
      prisma.vendor.findUnique.mockResolvedValue(vendorRow({ slug: 'blue-ice', name: 'BLUE ICE', branding: null }));
      expect(await service.publicBrandingForVendor('v-bi')).toMatchObject({ builtinLogo: true, name: 'BLUE ICE' });
      expect(await service.publicBrandingForVendor('v-other')).toMatchObject({ builtinLogo: false });
    });

    it('a vendor without a profile falls back to its own name; an inactive or unknown vendor is not exposed', async () => {
      prisma.vendor.findUnique.mockResolvedValue(vendorRow({ branding: null }));
      expect(await service.publicBrandingForVendor('v')).toMatchObject({ name: 'Lorem', logoUrl: null, builtinLogo: false });
      prisma.vendor.findUnique.mockResolvedValue(vendorRow({ isActive: false }));
      expect(await service.publicBrandingForVendor('v')).toBeNull();
      prisma.vendor.findUnique.mockResolvedValue(null);
      expect(await service.publicBrandingBySlug('nope')).toBeNull();
    });

    it('portal payment accounts carry the account details but not the internal note', async () => {
      prisma.vendorBranding.findUnique.mockResolvedValue({
        paymentAccounts: [{ kind: 'BANK', accountTitle: 'Lorem', bankName: 'HBL', accountNumber: '1234-5678', iban: 'PK36SCBL0000001123456702', note: 'internal only' }],
      });
      const accts = await service.portalPaymentAccounts('v-lorem');
      expect(accts).toEqual([{ kind: 'BANK', accountTitle: 'Lorem', accountNumber: '1234-5678', bankName: 'HBL', iban: 'PK36SCBL0000001123456702', branch: null }]);
      expect(JSON.stringify(accts)).not.toContain('internal only');
    });
  });

  describe('get / completeness', () => {
    it('reports what is still missing for go-live and pre-fills suggestions from the vendor', async () => {
      const view = await service.get('v-lorem');
      expect(view.exists).toBe(false);
      expect(view.missing).toEqual(['displayName', 'address', 'phones', 'paymentAccounts']);
      expect(view.suggested).toEqual({ displayName: 'Lorem', address: 'Lahore addr' });
    });

    it('missingRequired / parsePaymentAccounts are defensive about bad data', () => {
      expect(missingRequired(row() as any)).toEqual([]);
      expect(missingRequired(row({ paymentAccounts: [] }) as any)).toEqual(['paymentAccounts']);
      expect(parsePaymentAccounts('nope')).toEqual([]);
      expect(parsePaymentAccounts([{ kind: 'X', accountTitle: 't', accountNumber: '1' }, { kind: 'RAAST', accountTitle: 't', accountNumber: '03001234567' }])).toHaveLength(1);
    });
  });
});
