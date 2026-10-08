import { resolveDocBranding, LEGACY_DOC_BRANDING } from './doc-branding';
import { resetGateLogThrottle } from '../tenant-gate/legacy-vendor-gate';

const ENV_KEYS = ['WHATSAPP_GUARD_MODE', 'WHATSAPP_ALLOWED_VENDOR_IDS'] as const;

describe('resolveDocBranding (P0)', () => {
  const saved: Record<string, string | undefined> = {};
  const findUnique = jest.fn();
  const prisma = { vendor: { findUnique } };

  beforeEach(() => {
    ENV_KEYS.forEach((k) => {
      saved[k] = process.env[k];
      delete process.env[k];
    });
    resetGateLogThrottle();
    findUnique.mockReset();
  });
  afterEach(() => {
    ENV_KEYS.forEach((k) => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    });
  });

  it('shadow (default): every vendor keeps the legacy identity and the DB is not touched', async () => {
    expect(await resolveDocBranding(prisma, 'lorem')).toBe(LEGACY_DOC_BRANDING);
    expect(await resolveDocBranding(prisma, undefined)).toBe(LEGACY_DOC_BRANDING);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('enforce: the allow-listed vendor keeps the legacy identity', async () => {
    process.env['WHATSAPP_GUARD_MODE'] = 'enforce';
    process.env['WHATSAPP_ALLOWED_VENDOR_IDS'] = 'blue-ice';
    expect(await resolveDocBranding(prisma, 'blue-ice')).toBe(LEGACY_DOC_BRANDING);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('enforce: any other vendor gets a neutral branding with its OWN name and address', async () => {
    process.env['WHATSAPP_GUARD_MODE'] = 'enforce';
    process.env['WHATSAPP_ALLOWED_VENDOR_IDS'] = 'blue-ice';
    findUnique.mockResolvedValue({ name: 'Lorem Water', address: 'Lahore' });
    expect(await resolveDocBranding(prisma, 'lorem')).toEqual({ legacy: false, name: 'Lorem Water', address: 'Lahore' });
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'lorem' }, select: { name: true, address: true } });
  });

  it('enforce: DB failure / missing vendorId still yields neutral (never legacy) using the fallback name', async () => {
    process.env['WHATSAPP_GUARD_MODE'] = 'enforce';
    process.env['WHATSAPP_ALLOWED_VENDOR_IDS'] = 'blue-ice';
    findUnique.mockRejectedValue(new Error('db down'));
    expect(await resolveDocBranding(prisma, 'lorem', 'Fallback Co')).toEqual({ legacy: false, name: 'Fallback Co', address: null });
    expect(await resolveDocBranding(prisma, undefined, 'Fallback Co')).toEqual({ legacy: false, name: 'Fallback Co', address: null });
  });
});
